-- Critical production hardening found during the 2026-07-31 end-to-end audit.
--
-- Goals:
--   * remove anonymous access to sensitive gym billing/bank columns;
--   * stop users changing tenant/security fields on their own profile;
--   * replace legacy profile.gym_id authorization with active link tables;
--   * enforce tenant and state invariants for check-ins, class bookings and waivers;
--   * make future waiver signature files private;
--   * remove privileges that the Data API never needs.

-- ---------------------------------------------------------------------------
-- Profiles: keep the legacy user_id compatibility column correct, then make
-- tenant/security fields immutable through the self-service UPDATE policy.
-- ---------------------------------------------------------------------------

create or replace function public.sync_profile_derived_columns()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if new.full_name is null or new.full_name = '' then
    new.full_name := nullif(
      trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')),
      ''
    );
  end if;

  if new.full_name is not null
     and new.first_name is null and new.last_name is null then
    new.first_name := split_part(new.full_name, ' ', 1);
    new.last_name := nullif(
      trim(substr(new.full_name, length(split_part(new.full_name, ' ', 1)) + 2)),
      ''
    );
  end if;

  new.member_id := upper(replace(new.id::text, '-', ''));
  new.user_id := new.id;
  return new;
end;
$$;

update public.profiles
set user_id = id
where user_id is distinct from id;

alter table public.profiles alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_user_id_matches_id'
  ) then
    alter table public.profiles
      add constraint profiles_user_id_matches_id
      check (user_id = id) not valid;
  end if;
end
$$;

alter table public.profiles validate constraint profiles_user_id_matches_id;

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert
on public.profiles
for insert
to authenticated
with check (
  (select auth.uid()) = id
  and role = 'member'
  and gym_id is null
  and is_active is true
  and user_id = id
);

drop policy if exists profiles_update_no_escalation on public.profiles;
create policy profiles_update_no_escalation
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check (
  (select auth.uid()) = id
  and role is not distinct from (
    select p.role from public.profiles p where p.id = (select auth.uid())
  )
  and gym_id is not distinct from (
    select p.gym_id from public.profiles p where p.id = (select auth.uid())
  )
  and is_active is not distinct from (
    select p.is_active from public.profiles p where p.id = (select auth.uid())
  )
  and user_id is not distinct from (
    select p.user_id from public.profiles p where p.id = (select auth.uid())
  )
);

drop policy if exists profiles_delete_none on public.profiles;
create policy profiles_delete_none
on public.profiles
for delete
to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- Canonical tenant helpers: active staff/member links are the authority.
-- profiles.gym_id is retained for compatibility/display only.
-- ---------------------------------------------------------------------------

create or replace function public.is_gym_staff(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1
    from public.gym_staff_links s
    where s.user_id = (select auth.uid())
      and s.gym_id = _gym_id
      and s.is_active is true
  ) or public.is_platform_admin();
$$;

create or replace function public.is_gym_member(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1
    from public.gym_member_links m
    where m.user_id = (select auth.uid())
      and m.gym_id = _gym_id
      and m.is_active is true
  ) or public.is_platform_admin();
$$;

create or replace function public.is_gym_owner(_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1
    from public.gym_staff_links s
    where s.user_id = (select auth.uid())
      and s.gym_id = _gym_id
      and s.is_active is true
      and s.role = any (array['gym_owner'::public.user_role, 'manager'::public.user_role])
  ) or public.is_platform_admin();
$$;

create or replace function public.get_current_gym_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select coalesce(
    (
      select s.gym_id
      from public.gym_staff_links s
      where s.user_id = (select auth.uid()) and s.is_active is true
      order by s.created_at
      limit 1
    ),
    (
      select m.gym_id
      from public.gym_member_links m
      where m.user_id = (select auth.uid()) and m.is_active is true
      order by m.joined_at
      limit 1
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Gyms: the old SELECT true policy exposed full bank account numbers and
-- Paystack identifiers anonymously. Public pages already use the server-side
-- service client; Data API users now see only gyms they belong to.
-- ---------------------------------------------------------------------------

drop policy if exists gyms_select on public.gyms;
create policy gyms_select_scoped
on public.gyms
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = gyms.id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
  or exists (
    select 1 from public.gym_member_links m
    where m.gym_id = gyms.id
      and m.user_id = (select auth.uid())
      and m.is_active is true
  )
);

drop policy if exists gyms_insert on public.gyms;
create policy gyms_insert
on public.gyms
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists gyms_update_owner_only on public.gyms;
create policy gyms_update_owner_only
on public.gyms
for update
to authenticated
using (
  public.has_gym_role(id, array['gym_owner'::public.user_role, 'manager'::public.user_role])
  or public.is_platform_admin()
)
with check (
  public.has_gym_role(id, array['gym_owner'::public.user_role, 'manager'::public.user_role])
  or public.is_platform_admin()
);

drop policy if exists gyms_delete_owner_only on public.gyms;
create policy gyms_delete_owner_only
on public.gyms
for delete
to authenticated
using (
  public.has_gym_role(id, array['gym_owner'::public.user_role])
  or public.is_platform_admin()
);

revoke all privileges on table public.gyms from anon;

-- Self-linking bypassed the server-side invitation/member-code flow.
drop policy if exists gml_insert_self on public.gym_member_links;

drop policy if exists gml_select on public.gym_member_links;
create policy gml_select
on public.gym_member_links
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.gym_staff_links s
    where s.user_id = (select auth.uid())
      and s.gym_id = gym_member_links.gym_id
      and s.is_active is true
  )
  or public.is_platform_admin()
);

drop policy if exists gym_staff_links_all on public.gym_staff_links;
create policy gym_staff_links_all
on public.gym_staff_links
for all
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists gym_staff_links_select_manager on public.gym_staff_links;
create policy gym_staff_links_select_manager
on public.gym_staff_links
for select
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists gym_staff_links_select_own on public.gym_staff_links;
create policy gym_staff_links_select_own
on public.gym_staff_links
for select
to authenticated
using (user_id = (select auth.uid()));

-- Replace every authorization rule that trusted mutable profiles.gym_id.
drop policy if exists bh_select on public.business_hours;
create policy bh_select
on public.business_hours
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = business_hours.gym_id
      and s.user_id = (select auth.uid()) and s.is_active is true
  )
  or exists (
    select 1 from public.gym_member_links m
    where m.gym_id = business_hours.gym_id
      and m.user_id = (select auth.uid()) and m.is_active is true
  )
);

drop policy if exists bh_insert_owner on public.business_hours;
create policy bh_insert_owner on public.business_hours
for insert to authenticated
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists bh_update_owner on public.business_hours;
create policy bh_update_owner on public.business_hours
for update to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists bh_delete_owner on public.business_hours;
create policy bh_delete_owner on public.business_hours
for delete to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists equipment_maintenance_gym on public.equipment_maintenance;
create policy equipment_maintenance_gym
on public.equipment_maintenance
for all
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists reminders_write_owner on public.reminders;
create policy reminders_write_owner
on public.reminders
for all
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists salary_payments_owner on public.salary_payments;
create policy salary_payments_owner
on public.salary_payments
for all
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists staff_write_owner on public.staff;
create policy staff_write_owner
on public.staff
for all
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]))
with check (public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role]));

drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_select_admin
on public.client_errors
for select
to authenticated
using (
  public.is_platform_admin()
  or (
    gym_id is not null
    and public.has_gym_role(gym_id, array['gym_owner'::public.user_role, 'manager'::public.user_role])
  )
);

drop policy if exists support_tickets_staff_insert on public.support_tickets;
create policy support_tickets_staff_insert
on public.support_tickets
for insert
to authenticated
with check (gym_id is not null and public.is_gym_staff(gym_id));

drop policy if exists support_tickets_staff_select on public.support_tickets;
create policy support_tickets_staff_select
on public.support_tickets
for select
to authenticated
using (gym_id is not null and public.is_gym_staff(gym_id));

-- ---------------------------------------------------------------------------
-- Check-ins: members may still use the existing server action/client session,
-- but the database now enforces membership, subscription, timestamps and the
-- only valid self-update (closing an open visit).
-- ---------------------------------------------------------------------------

create or replace function public.validate_check_in_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
  caller_is_staff boolean;
begin
  if caller is null then
    return new;
  end if;

  select exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = new.gym_id
      and s.user_id = caller
      and s.is_active is true
  ) into caller_is_staff;

  if caller = new.member_id and not caller_is_staff then
    if tg_op = 'INSERT' then
      if not exists (
        select 1 from public.gym_member_links m
        where m.gym_id = new.gym_id
          and m.user_id = caller
          and m.is_active is true
      ) then
        raise exception 'Active gym membership is required for check-in' using errcode = '42501';
      end if;

      if not exists (
        select 1 from public.member_subscriptions ms
        where ms.gym_id = new.gym_id
          and ms.member_id = caller
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

revoke all on function public.validate_check_in_write() from public, anon, authenticated;

drop trigger if exists trg_validate_check_in_write on public.check_ins;
create trigger trg_validate_check_in_write
before insert or update on public.check_ins
for each row execute function public.validate_check_in_write();

drop policy if exists checkins_insert_self on public.check_ins;
create policy checkins_insert_self
on public.check_ins
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and check_in_method = 'self'
  and status = 'active'
  and checked_out_at is null
  and exists (
    select 1 from public.gym_member_links m
    where m.gym_id = check_ins.gym_id
      and m.user_id = (select auth.uid())
      and m.is_active is true
  )
  and exists (
    select 1 from public.member_subscriptions ms
    where ms.gym_id = check_ins.gym_id
      and ms.member_id = (select auth.uid())
      and ms.status in ('active', 'past_due')
      and ms.end_date >= (now() at time zone 'Africa/Lagos')::date
  )
);

drop policy if exists checkins_update_self on public.check_ins;
create policy checkins_update_self
on public.check_ins
for update
to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()));

create unique index if not exists check_ins_one_open_visit_idx
on public.check_ins (gym_id, member_id)
where status = 'active' and checked_out_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.check_ins'::regclass
      and conname = 'check_ins_checkout_after_checkin'
  ) then
    alter table public.check_ins
      add constraint check_ins_checkout_after_checkin
      check (checked_out_at is null or checked_out_at >= checked_in_at) not valid;
  end if;
end
$$;

alter table public.check_ins validate constraint check_ins_checkout_after_checkin;

-- ---------------------------------------------------------------------------
-- Class bookings: all three tenant keys must describe the same schedule, and
-- members may only create a valid booking or cancel their own existing one.
-- ---------------------------------------------------------------------------

create or replace function public.validate_class_booking_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
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
  from public.class_schedules s
  where s.id = new.class_schedule_id;

  if not found then
    raise exception 'Booking references an unknown class schedule' using errcode = '23503';
  end if;

  -- Derive omitted denormalized keys for compatibility with older callers,
  -- while rejecting an explicitly conflicting tenant or class.
  if new.gym_id is null then
    new.gym_id := schedule_gym;
  elsif new.gym_id is distinct from schedule_gym then
    raise exception 'Booking does not match its class schedule' using errcode = '23514';
  end if;

  if new.class_id is null then
    new.class_id := schedule_class;
  elsif new.class_id is distinct from schedule_class then
    raise exception 'Booking does not match its class schedule' using errcode = '23514';
  end if;

  if caller is null then
    return new;
  end if;

  select exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = new.gym_id
      and s.user_id = caller
      and s.is_active is true
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
           where m.gym_id = new.gym_id
             and m.user_id = caller
             and m.is_active is true
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

revoke all on function public.validate_class_booking_write() from public, anon, authenticated;

drop trigger if exists trg_validate_class_booking_write on public.class_bookings;
create trigger trg_validate_class_booking_write
before insert or update on public.class_bookings
for each row execute function public.validate_class_booking_write();

drop policy if exists bookings_member_insert on public.class_bookings;
create policy bookings_member_insert
on public.class_bookings
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and exists (
    select 1 from public.gym_member_links m
    where m.gym_id = class_bookings.gym_id
      and m.user_id = (select auth.uid())
      and m.is_active is true
  )
);

-- ---------------------------------------------------------------------------
-- Waivers and files: bind every signature to the member's gym and the active
-- waiver for that same gym; prevent duplicates; never publish signatures.
-- ---------------------------------------------------------------------------

drop policy if exists signatures_member_insert on public.waiver_signatures;
create policy signatures_member_insert
on public.waiver_signatures
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and exists (
    select 1 from public.gym_member_links m
    where m.gym_id = waiver_signatures.gym_id
      and m.user_id = (select auth.uid())
      and m.is_active is true
  )
  and exists (
    select 1 from public.waivers w
    where w.id = waiver_signatures.waiver_id
      and w.gym_id = waiver_signatures.gym_id
      and w.is_active is true
  )
);

create unique index if not exists waiver_signatures_one_per_waiver_member_idx
on public.waiver_signatures (gym_id, waiver_id, member_id);

update storage.buckets
set public = false
where id = 'waiver-signatures' and public is true;

-- Public landing pages use the server-side service client. These aggregate
-- SECURITY DEFINER functions no longer need to be callable over public RPC.
revoke execute on function public.gym_hourly_traffic(uuid, integer) from public, anon, authenticated;
revoke execute on function public.gym_live_occupancy(uuid) from public, anon, authenticated;

-- Data API roles never need schema-changing table privileges. Keep the DML
-- grants that RLS mediates, but remove TRUNCATE/REFERENCES/TRIGGER everywhere.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- Repair the one live status/date inconsistency found by the audit. The
-- existing sync trigger mirrors this update to member_subscriptions.
update public.memberships
set status = 'expired'
where status = 'active'
  and end_date < (now() at time zone 'Africa/Lagos')::date;

-- Remove only proven duplicate indexes; retain the constraint-backed unique
-- index on class_bookings.
drop index if exists public.checkins_member_gym_time_idx;
drop index if exists public.cb_schedule_date_status_idx;
drop index if exists public.class_bookings_gym_sched_member_uniq;
