-- GF022 / GF023 / GF046. The connected project used during this audit does
-- not contain GymFlow's schema, so storage policy names below are canonical
-- migration state, not a claim about observed live policy values.

-- Protected, profile-level health notes. The original field was global to a
-- profile, so migration preserves one authoritative note per member. Tenant
-- access is proven through an active membership at query/mutation time.
create table public.profile_health_notes (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  update_source text not null default 'protected_api',
  constraint profile_health_notes_length check (char_length(notes) <= 5000),
  constraint profile_health_notes_source check (update_source in ('migration', 'protected_api', 'legacy_adapter'))
);

create table public.profile_health_note_audit (
  id bigint generated always as identity primary key,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('set', 'clear')),
  source text not null check (source in ('protected_api', 'legacy_adapter')),
  reason text,
  note_length integer not null check (note_length >= 0),
  created_at timestamptz not null default now()
);
create index profile_health_note_audit_scope_idx
  on public.profile_health_note_audit (gym_id, member_id, created_at desc);

alter table public.profile_health_notes enable row level security;
alter table public.profile_health_note_audit enable row level security;
revoke all on public.profile_health_notes, public.profile_health_note_audit from public, anon, authenticated;
grant select on public.profile_health_notes, public.profile_health_note_audit to authenticated;
grant all on public.profile_health_notes, public.profile_health_note_audit to service_role;

create policy profile_health_notes_read on public.profile_health_notes
for select to authenticated
using (
  member_id = (select auth.uid())
  or exists (
    select 1 from public.gym_member_links m
    where m.member_id = profile_health_notes.member_id
      and m.is_active is true
      and (
        private.has_gym_role(
          m.gym_id,
          array['gym_owner'::public.user_role, 'manager'::public.user_role]
        )
        or (
          private.has_gym_role(m.gym_id, array['instructor'::public.user_role])
          and exists (
            select 1 from public.instructor_subscriptions assignment
            where assignment.gym_id = m.gym_id
              and assignment.member_id = m.member_id
              and assignment.instructor_id = (select auth.uid())
              and assignment.status = 'active'
              and assignment.start_date <= current_date
              and (assignment.end_date is null or assignment.end_date >= current_date)
          )
        )
      )
  )
);

create policy profile_health_note_audit_read on public.profile_health_note_audit
for select to authenticated
using (
  member_id = (select auth.uid())
  or private.has_gym_role(
    gym_id,
    array['gym_owner'::public.user_role, 'manager'::public.user_role]
  )
);

-- Members may manage their own note for an active gym relationship. Verified
-- owners/managers may manage a member linked to their gym. An actively assigned
-- instructor may read through RLS, but cannot mutate the note through this RPC.
create or replace function public.set_profile_health_note(
  p_gym_id uuid,
  p_member_id uuid,
  p_notes text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_notes text := nullif(btrim(p_notes), '');
  v_member_self boolean;
  v_staff boolean;
begin
  if char_length(v_notes) > 5000 then
    raise exception 'health note exceeds 5000 characters' using errcode = '22001';
  end if;

  select exists (
    select 1 from public.gym_member_links m
    where m.gym_id = p_gym_id and m.member_id = p_member_id
      and m.user_id = v_actor and m.is_active is true
  ) into v_member_self;
  select private.has_gym_role(
    p_gym_id,
    array['gym_owner'::public.user_role, 'manager'::public.user_role]
  ) into v_staff;

  if not exists (
    select 1 from public.gym_member_links m
    where m.gym_id = p_gym_id and m.member_id = p_member_id and m.is_active is true
  ) then
    raise exception 'member is not active in this gym' using errcode = '23503';
  end if;
  if not (v_member_self or v_staff) then
    raise exception 'not permitted to manage this health note' using errcode = '42501';
  end if;

  insert into public.profile_health_notes
    (member_id, notes, updated_at, updated_by, update_source)
  values (p_member_id, v_notes, now(), v_actor, 'protected_api')
  on conflict (member_id) do update
    set notes = excluded.notes, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, update_source = excluded.update_source;

  insert into public.profile_health_note_audit
    (gym_id, member_id, actor_id, action, source, reason, note_length)
  values (
    p_gym_id, p_member_id, v_actor,
    case when v_notes is null then 'clear' else 'set' end,
    'protected_api', nullif(left(btrim(p_reason), 500), ''),
    coalesce(char_length(v_notes), 0)
  );
end;
$function$;
revoke all on function public.set_profile_health_note(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_profile_health_note(uuid, uuid, text, text) to authenticated, service_role;

-- Preserve each existing non-empty profile value exactly once, then remove it
-- from the broadly readable compatibility column.
insert into public.profile_health_notes
  (member_id, notes, updated_at, updated_by, update_source)
select p.id, p.health_notes, now(), null, 'migration'
from public.profiles p
where nullif(btrim(p.health_notes), '') is not null
on conflict (member_id) do nothing;
update public.profiles set health_notes = null where health_notes is not null;

-- Guard old clients that still update profiles.health_notes. The target gym is
-- used only to prove tenant scope and record the audit context; the protected
-- note remains profile-level.
create or replace function private.route_legacy_profile_health_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_notes text := nullif(btrim(new.health_notes), '');
  v_gym uuid;
begin
  if new.health_notes is null then return new; end if;
  if char_length(v_notes) > 5000 then
    raise exception 'health note exceeds 5000 characters' using errcode = '22001';
  end if;

  select candidate.gym_id into v_gym
  from (
    select m.gym_id
    from public.gym_member_links m
    where m.member_id = new.id and m.is_active is true
    union
    select new.gym_id where new.gym_id is not null
  ) candidate
  where auth.role() = 'service_role'
     or (
       v_actor = new.id and exists (
         select 1 from public.gym_member_links own
         where own.gym_id = candidate.gym_id and own.member_id = new.id
           and own.user_id = v_actor and own.is_active is true
       )
     )
     or private.has_gym_role(
       candidate.gym_id,
       array['gym_owner'::public.user_role, 'manager'::public.user_role]
     )
  order by (candidate.gym_id = new.gym_id) desc, candidate.gym_id
  limit 1;

  if v_gym is null then
    raise exception 'no permitted gym scope for legacy health note' using errcode = '42501';
  end if;

  insert into public.profile_health_notes
    (member_id, notes, updated_at, updated_by, update_source)
  values (new.id, v_notes, now(), v_actor, 'legacy_adapter')
  on conflict (member_id) do update
    set notes = excluded.notes, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, update_source = excluded.update_source;
  insert into public.profile_health_note_audit
    (gym_id, member_id, actor_id, action, source, reason, note_length)
  values (
    v_gym, new.id, v_actor,
    case when v_notes is null then 'clear' else 'set' end,
    'legacy_adapter', 'legacy profiles.health_notes write',
    coalesce(char_length(v_notes), 0)
  );
  new.health_notes := null;
  return new;
end;
$function$;
revoke all on function private.route_legacy_profile_health_note() from public, anon, authenticated;
grant execute on function private.route_legacy_profile_health_note() to service_role;
create trigger profiles_route_legacy_health_note
before insert or update of health_notes on public.profiles
for each row execute function private.route_legacy_profile_health_note();

comment on table public.profile_health_notes is
  'Profile-level private health notes. Members see their own; verified owners/managers require an active member link in their gym.';
comment on column public.profiles.health_notes is
  'Deprecated compatibility input only. Authorised legacy writes transfer to profile_health_notes and this column always stores NULL.';

-- Lock, count and consume a WhatsApp signup OTP in one service-only database
-- transaction. Email and WhatsApp identity are both bound before the row locks.
-- Retire historical duplicates before enforcing one live challenge per address;
-- concurrent resend requests then cannot leave two independently usable codes.
with ranked as (
  select id, row_number() over (
    partition by lower(email), purpose order by created_at desc, id desc
  ) as position
  from public.whatsapp_email_otps
  where consumed_at is null
)
update public.whatsapp_email_otps o
set consumed_at = now()
from ranked r
where o.id = r.id and r.position > 1;

update public.whatsapp_email_otps
set email = lower(btrim(email))
where email is distinct from lower(btrim(email));

create unique index whatsapp_email_otps_one_live_challenge_idx
  on public.whatsapp_email_otps (lower(email), purpose)
  where consumed_at is null;

create or replace function public.consume_whatsapp_email_otp(
  p_email text,
  p_wa_id text,
  p_code_hash text,
  p_max_attempts integer default 5
)
returns table (
  status text, otp_id uuid, user_id uuid, gym_id uuid,
  attempts_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_otp public.whatsapp_email_otps%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'invalid attempt limit' using errcode = '22023';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid code hash' using errcode = '22023';
  end if;

  select * into v_otp
  from public.whatsapp_email_otps o
  where o.email = lower(btrim(p_email))
    and o.wa_id = p_wa_id
    and o.purpose = 'signup'
    and o.consumed_at is null
  order by o.created_at desc, o.id desc
  limit 1 for update;

  if not found then
    return query select 'missing'::text, null::uuid, null::uuid, null::uuid, 0;
    return;
  end if;
  if v_otp.expires_at <= v_now then
    update public.whatsapp_email_otps set consumed_at = v_now where id = v_otp.id;
    return query select 'expired'::text, v_otp.id, null::uuid, null::uuid, 0;
    return;
  end if;
  if v_otp.attempts >= p_max_attempts then
    update public.whatsapp_email_otps set consumed_at = v_now where id = v_otp.id;
    return query select 'locked'::text, v_otp.id, null::uuid, null::uuid, 0;
    return;
  end if;

  v_attempts := v_otp.attempts + 1;
  if v_otp.code_hash <> p_code_hash then
    update public.whatsapp_email_otps
      set attempts = v_attempts,
          consumed_at = case when v_attempts >= p_max_attempts then v_now else consumed_at end
      where id = v_otp.id;
    return query select case when v_attempts >= p_max_attempts then 'locked' else 'mismatch' end,
      v_otp.id, null::uuid, null::uuid,
      greatest(p_max_attempts - v_attempts, 0);
    return;
  end if;

  if v_otp.user_id is null or v_otp.gym_id is null then
    update public.whatsapp_email_otps set attempts = v_attempts, consumed_at = v_now where id = v_otp.id;
    return query select 'invalid_identity'::text, v_otp.id, null::uuid, null::uuid, 0;
    return;
  end if;

  update public.whatsapp_email_otps set attempts = v_attempts, consumed_at = v_now where id = v_otp.id;
  return query select 'matched'::text, v_otp.id, v_otp.user_id, v_otp.gym_id,
    greatest(p_max_attempts - v_attempts, 0);
end;
$function$;
revoke all on function public.consume_whatsapp_email_otp(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_whatsapp_email_otp(text, text, text, integer)
  to service_role;

-- Canonical storage policies. gym-assets stays a public CDN bucket, so these
-- policies govern authenticated listing/mutation. Every object key starts with
-- its gym UUID. Instructors are limited to their own avatar path.
drop policy if exists "gym_assets_read" on storage.objects;
drop policy if exists "gym_assets_staff_select" on storage.objects;
drop policy if exists "gym_assets_staff_insert" on storage.objects;
drop policy if exists "gym_assets_staff_update" on storage.objects;
drop policy if exists "gym_assets_staff_delete" on storage.objects;
drop policy if exists "gym_assets_tenant_select" on storage.objects;
drop policy if exists "gym_assets_tenant_insert" on storage.objects;
drop policy if exists "gym_assets_tenant_update" on storage.objects;
drop policy if exists "gym_assets_tenant_delete" on storage.objects;

create policy "gym_assets_tenant_select" on storage.objects
for select to authenticated using (
  bucket_id = 'gym-assets' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and (
        private.has_gym_role(g.id, array['gym_owner','manager']::public.user_role[])
        or (
          private.has_gym_role(g.id, array['instructor']::public.user_role[])
          and split_part(storage.objects.name, '/', 2) = 'avatars'
          and split_part(storage.objects.name, '/', 3) like (select auth.uid())::text || '-%'
        )
      )
  )
);

create policy "gym_assets_tenant_insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'gym-assets' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and (
        private.has_gym_role(g.id, array['gym_owner','manager']::public.user_role[])
        or (
          private.has_gym_role(g.id, array['instructor']::public.user_role[])
          and split_part(storage.objects.name, '/', 2) = 'avatars'
          and split_part(storage.objects.name, '/', 3) like (select auth.uid())::text || '-%'
        )
      )
  )
);

create policy "gym_assets_tenant_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'gym-assets' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and (
        private.has_gym_role(g.id, array['gym_owner','manager']::public.user_role[])
        or (
          private.has_gym_role(g.id, array['instructor']::public.user_role[])
          and split_part(storage.objects.name, '/', 2) = 'avatars'
          and split_part(storage.objects.name, '/', 3) like (select auth.uid())::text || '-%'
        )
      )
  )
)
with check (
  bucket_id = 'gym-assets' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and (
        private.has_gym_role(g.id, array['gym_owner','manager']::public.user_role[])
        or (
          private.has_gym_role(g.id, array['instructor']::public.user_role[])
          and split_part(storage.objects.name, '/', 2) = 'avatars'
          and split_part(storage.objects.name, '/', 3) like (select auth.uid())::text || '-%'
        )
      )
  )
);

create policy "gym_assets_tenant_delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'gym-assets' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and (
        private.has_gym_role(g.id, array['gym_owner','manager']::public.user_role[])
        or (
          private.has_gym_role(g.id, array['instructor']::public.user_role[])
          and split_part(storage.objects.name, '/', 2) = 'avatars'
          and split_part(storage.objects.name, '/', 3) like (select auth.uid())::text || '-%'
        )
      )
  )
);

-- Private general backups contain no health notes. Public/member access and
-- authenticated writes remain absent; verified owners/managers can retain the
-- existing signed-download flow, while service_role alone writes objects.
drop policy if exists "gym_backups_read" on storage.objects;
drop policy if exists "gym_backups_owner_manager_read" on storage.objects;
create policy "gym_backups_owner_manager_read" on storage.objects
for select to authenticated using (
  bucket_id = 'gym-backups' and exists (
    select 1 from public.gyms g
    where g.id::text = split_part(storage.objects.name, '/', 1)
      and private.has_gym_role(
        g.id,
        array['gym_owner'::public.user_role, 'manager'::public.user_role]
      )
  )
);
comment on policy "gym_backups_owner_manager_read" on storage.objects is
  'Private backup objects: no public/member access. Verified owner/manager reads preserve server-minted signed downloads; writes remain service-role only.';
