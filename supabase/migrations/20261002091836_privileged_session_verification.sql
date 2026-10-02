-- Bind every staff/platform privilege to a server-verified, live GoTrue
-- session. A password-grant JWT has a valid sub and role, but has no row here;
-- it therefore keeps member/self access while every privileged branch denies.

update public.gyms set two_factor_required = true where two_factor_required is false;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gyms'::regclass
      and conname = 'gyms_two_factor_mandatory'
  ) then
    alter table public.gyms add constraint gyms_two_factor_mandatory
      check (two_factor_required is true);
  end if;
end $$;

create table if not exists private.privileged_session_verifications (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  method text not null,
  trusted_device_id uuid references public.trusted_devices(id) on delete cascade,
  constraint privileged_session_verifications_method_check
    check (method in ('email_code', 'trusted_device')),
  constraint privileged_session_verifications_trusted_method_check
    check ((method = 'trusted_device') = (trusted_device_id is not null)),
  constraint privileged_session_verifications_expiry_check
    check (expires_at > verified_at)
);

create index if not exists idx_privileged_session_verifications_user
  on private.privileged_session_verifications (user_id, expires_at desc);

alter table private.privileged_session_verifications enable row level security;
revoke all on private.privileged_session_verifications from public, anon, authenticated, service_role;

create or replace function private.privileged_session_verified()
returns boolean
language plpgsql
stable
security definer
set search_path to 'private', 'auth', 'public', 'pg_temp'
as $$
declare
  claim text := auth.jwt() ->> 'session_id';
  caller uuid := auth.uid();
  sid uuid;
begin
  if caller is null or claim is null
     or claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  sid := claim::uuid;

  return exists (
    select 1
    from private.privileged_session_verifications v
    join auth.sessions s on s.id = v.session_id and s.user_id = v.user_id
    join auth.users u on u.id = v.user_id
    where v.session_id = sid
      and v.user_id = caller
      and v.expires_at > now()
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until <= now())
  );
exception when others then
  -- Authorization infrastructure must fail closed: malformed claims, schema
  -- drift, or an unavailable auth table can never become staff access.
  return false;
end;
$$;

revoke all on function private.privileged_session_verified() from public, anon;
grant execute on function private.privileged_session_verified() to authenticated, service_role;

-- Read-only status for the app guard. The caller cannot choose a user/session;
-- it evaluates the signed JWT attached by PostgREST.
create or replace function public.privileged_session_verified()
returns boolean
language sql
stable
security invoker
set search_path to 'private', 'public', 'pg_temp'
as $$ select private.privileged_session_verified() $$;
revoke all on function public.privileged_session_verified() from public, anon;
grant execute on function public.privileged_session_verified() to authenticated, service_role;

-- The service can add proof only for an existing, live GoTrue session owned by
-- the same user. The expiry is bounded to 18 hours and never exceeds the Auth
-- session's own not_after.
create or replace function public.grant_privileged_session_verification(
  p_session_id uuid,
  p_user_id uuid,
  p_method text,
  p_trusted_device_id uuid default null
)
returns timestamptz
language plpgsql
security definer
set search_path to 'private', 'auth', 'public', 'pg_temp'
as $$
declare
  session_deadline timestamptz;
  trusted_deadline timestamptz;
  proof_deadline timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_method not in ('email_code', 'trusted_device')
     or ((p_method = 'trusted_device') <> (p_trusted_device_id is not null)) then
    raise exception 'invalid verification method' using errcode = '22023';
  end if;

  select s.not_after into session_deadline
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  where s.id = p_session_id
    and s.user_id = p_user_id
    and (s.not_after is null or s.not_after > now())
    and (u.banned_until is null or u.banned_until <= now())
  for update of s;
  if not found then
    raise exception 'active Auth session not found for user' using errcode = '42501';
  end if;

  if p_method = 'trusted_device' then
    select d.expires_at into trusted_deadline
    from public.trusted_devices d
    where d.id = p_trusted_device_id
      and d.user_id = p_user_id
      and d.expires_at > now()
    for share of d;
    if not found then
      raise exception 'active trusted device not found for user' using errcode = '42501';
    end if;
  end if;

  proof_deadline := least(
    now() + interval '18 hours',
    coalesce(session_deadline, 'infinity'::timestamptz),
    coalesce(trusted_deadline, 'infinity'::timestamptz)
  );
  insert into private.privileged_session_verifications
    (session_id, user_id, verified_at, expires_at, method, trusted_device_id)
  values
    (p_session_id, p_user_id, now(), proof_deadline, p_method, p_trusted_device_id)
  on conflict (session_id) do update
    set user_id = excluded.user_id,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at,
        method = excluded.method,
        trusted_device_id = excluded.trusted_device_id;
  return proof_deadline;
end;
$$;
revoke all on function public.grant_privileged_session_verification(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.grant_privileged_session_verification(uuid, uuid, text, uuid)
  to service_role;

create or replace function public.revoke_privileged_session_verification(
  p_session_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'private', 'auth', 'public', 'pg_temp'
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from private.privileged_session_verifications
  where session_id = p_session_id and user_id = p_user_id;
end;
$$;
revoke all on function public.revoke_privileged_session_verification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_privileged_session_verification(uuid, uuid)
  to service_role;

create or replace function public.revoke_user_privileged_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'private', 'auth', 'public', 'pg_temp'
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from private.privileged_session_verifications where user_id = p_user_id;
end;
$$;
revoke all on function public.revoke_user_privileged_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_user_privileged_sessions(uuid) to service_role;

create or replace function public.prune_privileged_session_verifications()
returns bigint
language plpgsql
security definer
set search_path to 'private', 'auth', 'public', 'pg_temp'
as $$
declare removed bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from private.privileged_session_verifications v
  where v.expires_at <= now()
     or not exists (
       select 1 from auth.sessions s
       where s.id = v.session_id and s.user_id = v.user_id
         and (s.not_after is null or s.not_after > now())
     );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_privileged_session_verifications()
  from public, anon, authenticated;
grant execute on function public.prune_privileged_session_verifications() to service_role;

-- Verify + count + consume under one row lock. Supplying the salted expected
-- hash avoids putting the six-digit code into SQL storage/logs. Concurrent
-- redemption has exactly one success; the waiter observes consumed_at.
create or replace function public.verify_staff_email_challenge(
  p_challenge_id uuid,
  p_expected_hash text
)
returns table (
  accepted boolean,
  reason text,
  user_id uuid,
  email text,
  attempts integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  challenge public.auth_challenges%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into challenge
  from public.auth_challenges c
  where c.id = p_challenge_id
  for update;

  if not found then
    return query select false, 'missing'::text, null::uuid, null::text, 0;
  elsif challenge.consumed_at is not null then
    return query select false, 'consumed'::text, null::uuid, null::text, challenge.attempts;
  elsif challenge.expires_at <= now() then
    update public.auth_challenges set consumed_at = now() where id = challenge.id;
    return query select false, 'expired'::text, null::uuid, null::text, challenge.attempts;
  elsif challenge.attempts >= 5 then
    update public.auth_challenges set consumed_at = coalesce(consumed_at, now()) where id = challenge.id;
    return query select false, 'locked'::text, null::uuid, null::text, challenge.attempts;
  elsif challenge.code_hash is distinct from p_expected_hash then
    challenge.attempts := challenge.attempts + 1;
    update public.auth_challenges
      set attempts = challenge.attempts,
          consumed_at = case when challenge.attempts >= 5 then now() else consumed_at end
      where id = challenge.id;
    return query select false,
      case when challenge.attempts >= 5 then 'locked' else 'mismatch' end,
      null::uuid, null::text, challenge.attempts;
  else
    update public.auth_challenges set consumed_at = now() where id = challenge.id;
    return query select true, 'accepted'::text, challenge.user_id, challenge.email, challenge.attempts;
  end if;
end;
$$;
revoke all on function public.verify_staff_email_challenge(uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_staff_email_challenge(uuid, text)
  to service_role;

-- Canonical privileged predicates. These are the authority behind most RLS
-- policies; keeping proof inside them makes future policy reuse safe by
-- default and does not affect member-only policies.
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select private.privileged_session_verified()
    and exists (
      select 1 from public.platform_admins
      where user_id = (select auth.uid()) and is_active is true
    )
$$;

create or replace function private.has_gym_role(
  p_gym_id uuid,
  p_roles public.user_role[]
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select private.privileged_session_verified()
    and exists (
      select 1 from public.gym_staff_links
      where gym_id = p_gym_id
        and user_id = (select auth.uid())
        and role = any(p_roles)
        and is_active is true
    )
$$;

create or replace function private.is_gym_staff(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select private.privileged_session_verified()
    and (
      exists (
        select 1 from public.gym_staff_links s
        where s.gym_id = _gym_id
          and s.user_id = (select auth.uid())
          and s.is_active is true
      )
      or exists (
        select 1 from public.platform_admins p
        where p.user_id = (select auth.uid()) and p.is_active is true
      )
    )
$$;

-- Legacy helpers still referenced by older code/policies must not become a
-- side door around the canonical predicates.
create or replace function public.is_gym_owner(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select private.has_gym_role(_gym_id, array['gym_owner'::public.user_role])
      or private.is_platform_admin()
$$;

revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.has_gym_role(uuid, public.user_role[]) from public, anon;
revoke all on function private.is_gym_staff(uuid) from public, anon;
grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.has_gym_role(uuid, public.user_role[]) to authenticated, service_role;
grant execute on function private.is_gym_staff(uuid) to authenticated, service_role;

create or replace function public.get_current_gym_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce(
    (
      select s.gym_id from public.gym_staff_links s
      where private.privileged_session_verified()
        and s.user_id = (select auth.uid()) and s.is_active is true
      order by s.created_at limit 1
    ),
    (
      select m.gym_id from public.gym_member_links m
      where m.user_id = (select auth.uid()) and m.is_active is true
      order by m.joined_at limit 1
    )
  )
$$;

create or replace function public.can_see_profile(target_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public', 'private', 'pg_temp'
as $$
  select target_user_id = auth.uid()
    or (
      private.privileged_session_verified()
      and exists (
        select 1 from public.gym_staff_links me
        join public.gym_member_links them on me.gym_id = them.gym_id
        where me.user_id = auth.uid() and me.is_active is true
          and them.user_id = target_user_id
      )
    )
    or (
      private.privileged_session_verified()
      and exists (
        select 1 from public.gym_staff_links me
        join public.gym_staff_links them on me.gym_id = them.gym_id
        where me.user_id = auth.uid() and me.is_active is true
          and them.user_id = target_user_id
      )
    )
    or private.is_platform_admin()
$$;

-- Direct staff predicates left over from the legacy schema are gated here.
-- Mixed policies preserve their member/self branch at AAL1.
alter policy bh_select on public.business_hours using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = business_hours.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or exists (
    select 1 from public.gym_member_links m where m.gym_id = business_hours.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  )
);

alter policy checkins_select_scoped on public.check_ins using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = check_ins.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or private.is_platform_admin()
);

alter policy bookings_instructor_select on public.class_bookings using (
  private.privileged_session_verified() and exists (
    select 1 from public.class_schedules cs
    where cs.id = class_bookings.class_schedule_id
      and cs.instructor_id = (select auth.uid())
  )
);
alter policy bookings_instructor_update on public.class_bookings
  using (
    private.privileged_session_verified() and exists (
      select 1 from public.class_schedules cs
      where cs.id = class_bookings.class_schedule_id
        and cs.instructor_id = (select auth.uid())
    )
  )
  with check (
    private.privileged_session_verified() and exists (
      select 1 from public.class_schedules cs
      where cs.id = class_bookings.class_schedule_id
        and cs.gym_id = class_bookings.gym_id
        and cs.instructor_id = (select auth.uid())
    )
  );
alter policy bookings_staff_select on public.class_bookings using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = class_bookings.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy bookings_staff_update on public.class_bookings
  using (
    private.privileged_session_verified() and exists (
      select 1 from public.gym_staff_links s where s.gym_id = class_bookings.gym_id
        and s.user_id = (select auth.uid()) and s.is_active is true
    )
  )
  with check (
    private.privileged_session_verified() and exists (
      select 1 from public.gym_staff_links s where s.gym_id = class_bookings.gym_id
        and s.user_id = (select auth.uid()) and s.is_active is true
    )
  );

alter policy schedules_select_scoped on public.class_schedules using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = class_schedules.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or (is_active is true and exists (
    select 1 from public.gym_member_links m where m.gym_id = class_schedules.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  ))
);
alter policy classes_select_scoped on public.classes using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = classes.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or (is_active is true and exists (
    select 1 from public.gym_member_links m where m.gym_id = classes.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  ))
);

alter policy equipment_select_staff on public.equipment using (
  (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = equipment.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )) or private.is_platform_admin()
);
alter policy equipment_staff_write on public.equipment
  using (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = equipment.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  with check (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = equipment.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ));
alter policy expenses_staff_all on public.expenses
  using (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = expenses.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  with check (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = expenses.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ));
alter policy export_logs_select_staff on public.export_logs using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = export_logs.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy gym_backups_select_managers on public.gym_backups using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = gym_backups.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
      and s.role in ('gym_owner', 'manager')
  )
);

alter policy gml_select on public.gym_member_links using (
  user_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.user_id = (select auth.uid())
      and s.gym_id = gym_member_links.gym_id and s.is_active is true
  ))
  or private.is_platform_admin()
);
alter policy gyms_select_scoped on public.gyms using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = gyms.id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or exists (
    select 1 from public.gym_member_links m where m.gym_id = gyms.id
      and m.user_id = (select auth.uid()) and m.is_active is true
  )
);

alter policy instructor_bank_details_insert_own on public.instructor_bank_details
  with check (private.privileged_session_verified() and instructor_id = (select auth.uid()));
alter policy instructor_bank_details_select_own on public.instructor_bank_details
  using (private.privileged_session_verified() and instructor_id = (select auth.uid()));
alter policy instructor_bank_details_update_own on public.instructor_bank_details
  using (private.privileged_session_verified() and instructor_id = (select auth.uid()))
  with check (private.privileged_session_verified() and instructor_id = (select auth.uid()));

alter policy ipay_insert_instructor on public.instructor_payouts with check (
  private.privileged_session_verified()
  and instructor_id = (select auth.uid())
  and status = 'requested'
  and exists (
    select 1 from public.gym_staff_links l where l.user_id = (select auth.uid())
      and l.gym_id = instructor_payouts.gym_id and l.role = 'instructor'
      and coalesce(l.is_active, true)
  )
);
alter policy ipay_select on public.instructor_payouts using (
  private.privileged_session_verified() and (
    instructor_id = (select auth.uid())
    or exists (
      select 1 from public.gym_staff_links s where s.gym_id = instructor_payouts.gym_id
        and s.user_id = (select auth.uid()) and s.role in ('gym_owner','manager')
        and s.is_active is true
    )
  )
);

alter policy isess_insert_instructor on public.instructor_sessions with check (
  private.privileged_session_verified()
  and instructor_id = (select auth.uid())
  and exists (
    select 1 from public.gym_staff_links s where s.gym_id = instructor_sessions.gym_id
      and s.user_id = (select auth.uid()) and s.role = 'instructor' and s.is_active is true
  )
);
alter policy isess_select on public.instructor_sessions using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and (
    instructor_id = (select auth.uid())
    or exists (
      select 1 from public.gym_staff_links s where s.gym_id = instructor_sessions.gym_id
        and s.user_id = (select auth.uid()) and s.is_active is true
    )
  ))
);
alter policy isess_update_instructor on public.instructor_sessions
  using (private.privileged_session_verified() and instructor_id = (select auth.uid()))
  with check (private.privileged_session_verified() and instructor_id = (select auth.uid()));
alter policy is_select_self_or_gym on public.instructor_subscriptions using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and (
    instructor_id = (select auth.uid())
    or exists (
      select 1 from public.gym_staff_links s where s.gym_id = instructor_subscriptions.gym_id
        and s.user_id = (select auth.uid()) and s.is_active is true
    )
  ))
);

alter policy msub_select_self_or_gym on public.member_subscriptions using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = member_subscriptions.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
);
alter policy plans_select_scoped on public.membership_plans using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = membership_plans.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or (is_active is true and exists (
    select 1 from public.gym_member_links m where m.gym_id = membership_plans.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  ))
);
alter policy memberships_select_scoped on public.memberships using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = memberships.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or private.is_platform_admin()
);
alter policy notif_select_self_or_gym on public.notifications using (
  user_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = notifications.gym_id
      and s.user_id = (select auth.uid())
      and s.role in ('gym_owner','manager','front_desk','accountant')
      and s.is_active is true
  ))
);
alter policy pp_select_gym_or_admin on public.platform_payments using (
  (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = platform_payments.gym_id
      and s.user_id = (select auth.uid()) and s.role = 'gym_owner' and s.is_active is true
  )) or private.is_platform_admin()
);
alter policy reminder_logs_select_staff on public.reminder_logs using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = reminder_logs.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy reminder_logs_staff_insert on public.reminder_logs with check (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = reminder_logs.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy reminders_select_staff on public.reminders using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = reminders.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy staff_select_scoped on public.staff using (
  private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = staff.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
);
alter policy signatures_select_scoped on public.waiver_signatures using (
  member_id = (select auth.uid())
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = waiver_signatures.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
);
alter policy waivers_select_scoped on public.waivers using (
  private.is_platform_admin()
  or (private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s where s.gym_id = waivers.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  ))
  or (is_active is true and exists (
    select 1 from public.gym_member_links m where m.gym_id = waivers.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  ))
);

alter policy gym_docs_read on storage.objects using (
  bucket_id = 'gym-docs' and auth.role() = 'authenticated'
  and private.privileged_session_verified()
  and (
    exists (
      select 1 from public.gym_staff_links s where s.user_id = auth.uid()
        and s.is_active is true and s.gym_id::text = split_part(objects.name, '/', 1)
    )
    or exists (
      select 1 from public.platform_admins p where p.user_id = auth.uid() and p.is_active is true
    )
  )
);
alter policy gym_docs_write on storage.objects with check (
  bucket_id = 'gym-docs' and auth.role() = 'authenticated'
  and private.privileged_session_verified()
  and exists (
    select 1 from public.gym_staff_links s where s.user_id = auth.uid()
      and s.is_active is true and s.role in ('gym_owner','manager')
      and s.gym_id::text = split_part(objects.name, '/', 1)
  )
);
alter policy gym_docs_update on storage.objects using (
  bucket_id = 'gym-docs' and auth.role() = 'authenticated'
  and private.privileged_session_verified()
  and exists (
    select 1 from public.gym_staff_links s where s.user_id = auth.uid()
      and s.is_active is true and s.role in ('gym_owner','manager')
      and s.gym_id::text = split_part(objects.name, '/', 1)
  )
);
alter policy gym_docs_delete on storage.objects using (
  bucket_id = 'gym-docs' and auth.role() = 'authenticated'
  and private.privileged_session_verified()
  and exists (
    select 1 from public.gym_staff_links s where s.user_id = auth.uid()
      and s.is_active is true and s.role in ('gym_owner','manager')
      and s.gym_id::text = split_part(objects.name, '/', 1)
  )
);

-- Trigger-side authorization must use the same proof. These SECURITY DEFINER
-- functions otherwise see raw staff links and could treat an unverified user
-- who is also a member as staff, bypassing the stricter member state checks.
create or replace function public.authorize_class_booking_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null then return new; end if;
  if not exists (
    select 1 from public.gym_member_links m
    where m.gym_id = new.gym_id and m.user_id = new.member_id
      and (tg_op = 'UPDATE' or m.is_active is true)
  ) then
    raise exception 'Booking member is not active in this gym' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and caller is distinct from old.member_id then
    if private.privileged_session_verified() and exists (
      select 1 from public.gym_staff_links s
      where s.gym_id = new.gym_id and s.user_id = caller and s.is_active is true
    ) then return new; end if;
    if private.privileged_session_verified() and exists (
      select 1 from public.class_schedules cs
      where cs.id = new.class_schedule_id and cs.gym_id = new.gym_id
        and cs.instructor_id = caller
    ) then return new; end if;
    raise exception 'Not authorized to move this class booking' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.validate_checkin_code_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
  caller_is_staff boolean;
begin
  if caller is null then return new; end if;
  select private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = new.gym_id and s.user_id = caller and s.is_active is true
  ) into caller_is_staff;

  if caller = new.member_id and not caller_is_staff then
    if tg_op = 'INSERT' then
      if new.code !~ '^[0-9]{6}$'
         or new.used_at is not null
         or new.created_at < now() - interval '5 minutes'
         or new.created_at > now() + interval '1 minute'
         or new.expires_at < new.created_at + interval '9 minutes'
         or new.expires_at > new.created_at + interval '11 minutes'
         or not exists (
           select 1 from public.gym_member_links m
           where m.gym_id = new.gym_id and m.user_id = caller and m.is_active is true
         )
         or (
           not exists (
             select 1 from public.member_subscriptions ms
             where ms.gym_id = new.gym_id and ms.member_id = caller
               and ms.status in ('active', 'past_due')
               and ms.end_date >= (now() at time zone 'Africa/Lagos')::date
           )
           and not exists (
             select 1 from public.check_ins ci
             where ci.gym_id = new.gym_id and ci.member_id = caller
               and ci.status = 'active' and ci.checked_out_at is null
           )
         ) then
        raise exception 'Invalid member check-in code' using errcode = '42501';
      end if;
    else
      if new.id is distinct from old.id
         or new.gym_id is distinct from old.gym_id
         or new.member_id is distinct from old.member_id
         or new.code is distinct from old.code
         or new.created_at is distinct from old.created_at
         or new.expires_at is distinct from old.expires_at
         or old.used_at is not null
         or new.used_at is null
         or new.used_at < now() - interval '5 minutes'
         or new.used_at > now() + interval '1 minute' then
        raise exception 'Members may only invalidate their own unused code' using errcode = '42501';
      end if;
    end if;
  elsif not caller_is_staff then
    raise exception 'Not authorized to change this check-in code' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.validate_check_in_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
  caller_is_staff boolean;
begin
  if caller is null then return new; end if;
  select private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = new.gym_id and s.user_id = caller and s.is_active is true
  ) into caller_is_staff;

  if caller = new.member_id and not caller_is_staff then
    if tg_op = 'INSERT' then
      if not exists (
        select 1 from public.gym_member_links m
        where m.gym_id = new.gym_id and m.user_id = caller and m.is_active is true
      ) then
        raise exception 'Active gym membership is required for check-in' using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.member_subscriptions ms
        where ms.gym_id = new.gym_id and ms.member_id = caller
          and ms.status in ('active', 'past_due')
          and ms.end_date >= (now() at time zone 'Africa/Lagos')::date
      ) then
        raise exception 'Active subscription is required for check-in' using errcode = '42501';
      end if;
      if new.check_in_method is distinct from 'self'
         or new.status is distinct from 'active'
         or new.checked_out_at is not null
         or new.checked_in_at < now() - interval '5 minutes'
         or new.checked_in_at > now() + interval '5 minutes' then
        raise exception 'Invalid self check-in state' using errcode = '42501';
      end if;
    else
      if new.id is distinct from old.id
         or new.gym_id is distinct from old.gym_id
         or new.member_id is distinct from old.member_id
         or new.checked_in_at is distinct from old.checked_in_at
         or new.created_at is distinct from old.created_at
         or new.device_info is distinct from old.device_info
         or new.check_in_method is distinct from old.check_in_method
         or new.notes is distinct from old.notes
         or old.checked_out_at is not null
         or old.status is distinct from 'active'
         or new.status is distinct from 'completed'
         or new.checked_out_at is null
         or new.checked_out_at < old.checked_in_at
         or new.checked_out_at < now() - interval '5 minutes'
         or new.checked_out_at > now() + interval '5 minutes' then
        raise exception 'Members may only close their own open visit' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_class_booking_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
  schedule_gym uuid;
  schedule_class uuid;
  schedule_day integer;
  schedule_active boolean;
  caller_is_staff boolean;
begin
  select s.gym_id, s.class_id, s.day_of_week, coalesce(s.is_active, false)
  into schedule_gym, schedule_class, schedule_day, schedule_active
  from public.class_schedules s where s.id = new.class_schedule_id;
  if not found then
    raise exception 'Booking references an unknown class schedule' using errcode = '23503';
  end if;
  if new.gym_id is null then new.gym_id := schedule_gym;
  elsif new.gym_id is distinct from schedule_gym then
    raise exception 'Booking does not match its class schedule' using errcode = '23514';
  end if;
  if new.class_id is null then new.class_id := schedule_class;
  elsif new.class_id is distinct from schedule_class then
    raise exception 'Booking does not match its class schedule' using errcode = '23514';
  end if;
  if caller is null then return new; end if;
  select private.privileged_session_verified() and exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = new.gym_id and s.user_id = caller and s.is_active is true
  ) into caller_is_staff;

  if caller = new.member_id and not caller_is_staff then
    if tg_op = 'INSERT' then
      if not schedule_active
         or new.booking_date < (now() at time zone 'Africa/Lagos')::date
         or extract(dow from new.booking_date)::integer <> schedule_day
         or new.status not in ('booked', 'waitlisted')
         or coalesce(new.checked_in, false) is true
         or new.cancelled_at is not null
         or not exists (
           select 1 from public.gym_member_links m
           where m.gym_id = new.gym_id and m.user_id = caller and m.is_active is true
         ) then
        raise exception 'Invalid member class booking' using errcode = '42501';
      end if;
    else
      if new.id is distinct from old.id
         or new.gym_id is distinct from old.gym_id
         or new.class_schedule_id is distinct from old.class_schedule_id
         or new.class_id is distinct from old.class_id
         or new.member_id is distinct from old.member_id
         or new.booking_date is distinct from old.booking_date
         or new.booked_at is distinct from old.booked_at
         or new.checked_in is distinct from old.checked_in
         or old.status not in ('booked', 'waitlisted')
         or new.status is distinct from 'cancelled' then
        raise exception 'Members may only cancel their own booking' using errcode = '42501';
      end if;
      new.cancelled_at := now();
    end if;
  end if;
  return new;
end;
$$;
