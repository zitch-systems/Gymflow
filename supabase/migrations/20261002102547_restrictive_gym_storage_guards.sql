-- Defense-in-depth for hosted projects that may retain permissive Storage
-- policies created in the dashboard. Restrictive policies are ANDed with the
-- union of all permissive policies, so legacy grants cannot bypass these two
-- protected buckets. Other buckets retain their existing policy behavior.

-- Retained dashboard policies still appear in authorization audits even after
-- a restrictive guard makes them harmless. Add the session-proof condition to
-- direct legacy staff/admin predicates themselves, without changing their
-- commands, roles, names or behavior for unrelated buckets.
create or replace function private.harden_legacy_storage_policies()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row record;
  qualify text;
  check_expr text;
  alter_qualify boolean;
  alter_check boolean;
  changed integer := 0;
begin
  for policy_row in
    select p.polname,
      pg_get_expr(p.polqual, p.polrelid) as qualify,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_catalog.pg_policy p
    where p.polrelid = 'storage.objects'::regclass
  loop
    qualify := policy_row.qualify;
    check_expr := policy_row.check_expr;
    alter_qualify := qualify is not null
      and (lower(qualify) like '%gym_staff_links%' or lower(qualify) like '%platform_admins%')
      and lower(qualify) not like '%privileged_session_verified%';
    alter_check := check_expr is not null
      and (lower(check_expr) like '%gym_staff_links%' or lower(check_expr) like '%platform_admins%')
      and lower(check_expr) not like '%privileged_session_verified%';

    if alter_qualify or alter_check then
      execute format(
        'alter policy %I on storage.objects%s%s',
        policy_row.polname,
        case when alter_qualify then format(
          ' using ((%s) and (bucket_id not in (''gym-assets'',''gym-backups'') or private.privileged_session_verified()))',
          qualify
        ) else '' end,
        case when alter_check then format(
          ' with check ((%s) and (bucket_id not in (''gym-assets'',''gym-backups'') or private.privileged_session_verified()))',
          check_expr
        ) else '' end
      );
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

revoke all on function private.harden_legacy_storage_policies()
  from public, anon, authenticated, service_role;
select private.harden_legacy_storage_policies();

-- Policy expressions run with the caller's relation privileges. Put protected
-- tenant lookup behind a private SECURITY DEFINER function so an anonymous
-- caller can still use unrelated buckets without needing SELECT on gyms.
create or replace function private.gym_storage_guard_allows(
  p_bucket_id text,
  p_name text,
  p_operation text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  gym_id uuid;
begin
  if p_bucket_id not in ('gym-assets', 'gym-backups') then
    return true;
  end if;
  if auth.role() is distinct from 'authenticated'
    or p_operation not in ('select', 'insert', 'update', 'delete') then
    return false;
  end if;
  begin
    gym_id := split_part(p_name, '/', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if not exists (select 1 from public.gyms g where g.id = gym_id) then
    return false;
  end if;
  if p_bucket_id = 'gym-backups' then
    return p_operation = 'select' and private.has_gym_role(
      gym_id,
      array['gym_owner'::public.user_role, 'manager'::public.user_role]
    );
  end if;
  return private.has_gym_role(
    gym_id,
    array['gym_owner'::public.user_role, 'manager'::public.user_role]
  ) or (
    private.has_gym_role(gym_id, array['instructor'::public.user_role])
    and split_part(p_name, '/', 2) = 'avatars'
    and split_part(p_name, '/', 3) like auth.uid()::text || '-%'
  );
end;
$$;

revoke all on function private.gym_storage_guard_allows(text, text, text)
  from public, service_role;
grant execute on function private.gym_storage_guard_allows(text, text, text)
  to anon, authenticated;

create policy "gym_storage_guard_select"
on storage.objects as restrictive
for select to anon, authenticated
using (private.gym_storage_guard_allows(bucket_id, name, 'select'));

create policy "gym_storage_guard_insert"
on storage.objects as restrictive
for insert to anon, authenticated
with check (private.gym_storage_guard_allows(bucket_id, name, 'insert'));

create policy "gym_storage_guard_update"
on storage.objects as restrictive
for update to anon, authenticated
using (private.gym_storage_guard_allows(bucket_id, name, 'update'))
with check (private.gym_storage_guard_allows(bucket_id, name, 'update'));

create policy "gym_storage_guard_delete"
on storage.objects as restrictive
for delete to anon, authenticated
using (private.gym_storage_guard_allows(bucket_id, name, 'delete'));

comment on policy "gym_storage_guard_select" on storage.objects is
  'Restrictive guard: legacy permissive policies cannot expose gym-assets or private gym-backups.';
comment on policy "gym_storage_guard_insert" on storage.objects is
  'Restrictive guard: protected-bucket writes require the canonical verified tenant role and path.';
comment on policy "gym_storage_guard_update" on storage.objects is
  'Restrictive guard: both old and new protected object paths require canonical verified tenant access.';
comment on policy "gym_storage_guard_delete" on storage.objects is
  'Restrictive guard: private backups are service-only; asset deletes require canonical verified tenant access.';
