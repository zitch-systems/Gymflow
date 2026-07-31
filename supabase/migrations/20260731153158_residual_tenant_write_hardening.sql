-- Residual tenant and self-service hardening found after the first critical
-- production audit migration. This migration focuses on UPDATE paths whose
-- old row was authorized but whose replacement row was not fully constrained.

-- ---------------------------------------------------------------------------
-- Class bookings: authorize the NEW tenant/schedule/member on every Data API
-- write. Existing policies authorized the old row only, which let an
-- instructor or staff user move a booking to an unrelated tenant.
-- ---------------------------------------------------------------------------

create or replace function public.authorize_class_booking_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
begin
  -- Trusted backend writes use service_role and do not carry auth.uid().
  if caller is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.gym_member_links m
    where m.gym_id = new.gym_id
      and m.user_id = new.member_id
      and (tg_op = 'UPDATE' or m.is_active is true)
  ) then
    raise exception 'Booking member is not active in this gym' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and caller is distinct from old.member_id then
    if exists (
      select 1
      from public.gym_staff_links s
      where s.gym_id = new.gym_id
        and s.user_id = caller
        and s.is_active is true
    ) then
      return new;
    end if;

    if exists (
      select 1
      from public.class_schedules cs
      where cs.id = new.class_schedule_id
        and cs.gym_id = new.gym_id
        and cs.instructor_id = caller
    ) then
      return new;
    end if;

    raise exception 'Not authorized to move this class booking' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.authorize_class_booking_write() from public, anon, authenticated;

-- The name sorts after trg_validate_class_booking_write, so the compatibility
-- trigger can derive omitted gym_id/class_id before this authorization check.
drop trigger if exists trg_verify_class_booking_authorization on public.class_bookings;
create trigger trg_verify_class_booking_authorization
before insert or update on public.class_bookings
for each row execute function public.authorize_class_booking_write();

drop policy if exists bookings_instructor_update on public.class_bookings;
create policy bookings_instructor_update
on public.class_bookings
for update
to authenticated
using (
  exists (
    select 1 from public.class_schedules cs
    where cs.id = class_bookings.class_schedule_id
      and cs.instructor_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.class_schedules cs
    where cs.id = class_bookings.class_schedule_id
      and cs.gym_id = class_bookings.gym_id
      and cs.instructor_id = (select auth.uid())
  )
);

drop policy if exists bookings_staff_update on public.class_bookings;
create policy bookings_staff_update
on public.class_bookings
for update
to authenticated
using (
  exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = class_bookings.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
)
with check (
  exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = class_bookings.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
);

-- ---------------------------------------------------------------------------
-- Front-desk check-in codes: members may create only the six-digit, ten-minute
-- code used by the application and may only invalidate their own unused code.
-- Tenant, code, creation and expiry fields are immutable after insertion.
-- ---------------------------------------------------------------------------

create or replace function public.validate_checkin_code_write()
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
      if new.code !~ '^[0-9]{6}$'
         or new.used_at is not null
         or new.created_at < now() - interval '5 minutes'
         or new.created_at > now() + interval '1 minute'
         or new.expires_at < new.created_at + interval '9 minutes'
         or new.expires_at > new.created_at + interval '11 minutes'
         or not exists (
           select 1 from public.gym_member_links m
           where m.gym_id = new.gym_id
             and m.user_id = caller
             and m.is_active is true
         )
         or (
           not exists (
             select 1 from public.member_subscriptions ms
             where ms.gym_id = new.gym_id
               and ms.member_id = caller
               and ms.status in ('active', 'past_due')
               and ms.end_date >= (now() at time zone 'Africa/Lagos')::date
           )
           and not exists (
             select 1 from public.check_ins ci
             where ci.gym_id = new.gym_id
               and ci.member_id = caller
               and ci.status = 'active'
               and ci.checked_out_at is null
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

revoke all on function public.validate_checkin_code_write() from public, anon, authenticated;

drop trigger if exists trg_validate_checkin_code_write on public.checkin_codes;
create trigger trg_validate_checkin_code_write
before insert or update on public.checkin_codes
for each row execute function public.validate_checkin_code_write();

drop policy if exists checkin_codes_insert_self on public.checkin_codes;
create policy checkin_codes_insert_self
on public.checkin_codes
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and code ~ '^[0-9]{6}$'
  and used_at is null
  and expires_at >= created_at + interval '9 minutes'
  and expires_at <= created_at + interval '11 minutes'
  and exists (
    select 1 from public.gym_member_links m
    where m.gym_id = checkin_codes.gym_id
      and m.user_id = (select auth.uid())
      and m.is_active is true
  )
  and (
    exists (
      select 1 from public.member_subscriptions ms
      where ms.gym_id = checkin_codes.gym_id
        and ms.member_id = (select auth.uid())
        and ms.status in ('active', 'past_due')
        and ms.end_date >= (now() at time zone 'Africa/Lagos')::date
    )
    or exists (
      select 1 from public.check_ins ci
      where ci.gym_id = checkin_codes.gym_id
        and ci.member_id = (select auth.uid())
        and ci.status = 'active'
        and ci.checked_out_at is null
    )
  )
);

-- ---------------------------------------------------------------------------
-- Notifications: a user can acknowledge a notification, not rewrite its
-- tenant, recipient, content, type, channel or metadata through the Data API.
-- ---------------------------------------------------------------------------

create or replace function public.validate_notification_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    return new;
  end if;

  if caller = old.user_id then
    if new.id is distinct from old.id
       or new.gym_id is distinct from old.gym_id
       or new.user_id is distinct from old.user_id
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.type is distinct from old.type
       or new.channel is distinct from old.channel
       or new.sent_at is distinct from old.sent_at
       or new.metadata is distinct from old.metadata
       or new.created_at is distinct from old.created_at
       or new.is_read is not true
       or new.read_at is null
       or new.read_at < now() - interval '5 minutes'
       or new.read_at > now() + interval '1 minute' then
      raise exception 'Users may only mark their own notification as read' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_notification_self_update() from public, anon, authenticated;

drop trigger if exists trg_validate_notification_self_update on public.notifications;
create trigger trg_validate_notification_self_update
before update on public.notifications
for each row execute function public.validate_notification_self_update();

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update
on public.notifications
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Authenticated tenant reads: remove all-tenant reads of inactive classes,
-- schedules, plans (including Paystack plan codes) and waiver text.
-- ---------------------------------------------------------------------------

drop policy if exists classes_select on public.classes;
drop policy if exists classes_member_view on public.classes;
create policy classes_select_scoped
on public.classes
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = classes.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
  or (
    is_active is true
    and exists (
      select 1 from public.gym_member_links m
      where m.gym_id = classes.gym_id
        and m.user_id = (select auth.uid())
        and m.is_active is true
    )
  )
);

drop policy if exists schedules_select on public.class_schedules;
create policy schedules_select_scoped
on public.class_schedules
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = class_schedules.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
  or (
    is_active is true
    and exists (
      select 1 from public.gym_member_links m
      where m.gym_id = class_schedules.gym_id
        and m.user_id = (select auth.uid())
        and m.is_active is true
    )
  )
);

drop policy if exists plans_select on public.membership_plans;
create policy plans_select_scoped
on public.membership_plans
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = membership_plans.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
  or (
    is_active is true
    and exists (
      select 1 from public.gym_member_links m
      where m.gym_id = membership_plans.gym_id
        and m.user_id = (select auth.uid())
        and m.is_active is true
    )
  )
);

drop policy if exists plans_select_public on public.membership_plans;
revoke select on table public.membership_plans from anon;

drop policy if exists waivers_select on public.waivers;
create policy waivers_select_scoped
on public.waivers
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = waivers.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
  or (
    is_active is true
    and exists (
      select 1 from public.gym_member_links m
      where m.gym_id = waivers.gym_id
        and m.user_id = (select auth.uid())
        and m.is_active is true
    )
  )
);

-- ---------------------------------------------------------------------------
-- Policy hygiene: sensitive self/staff policies should target authenticated,
-- not the implicit public role. Remove duplicate legacy definitions.
-- ---------------------------------------------------------------------------

drop policy if exists audit_logs_select_gym_owner on public.audit_logs;
create policy audit_logs_select_gym_owner
on public.audit_logs
for select
to authenticated
using (public.has_gym_role(gym_id, array['gym_owner']::public.user_role[]));

drop policy if exists export_logs_select_staff on public.export_logs;
create policy export_logs_select_staff
on public.export_logs
for select
to authenticated
using (
  exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = export_logs.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
);

drop policy if exists gym_payout_accounts_rw on public.gym_payout_accounts;
create policy gym_payout_accounts_rw
on public.gym_payout_accounts
for all
to authenticated
using (
  public.is_platform_admin()
  or public.has_gym_role(gym_id, array['gym_owner', 'manager']::public.user_role[])
)
with check (
  public.is_platform_admin()
  or public.has_gym_role(gym_id, array['gym_owner', 'manager']::public.user_role[])
);

drop policy if exists payout_change_requests_read on public.payout_change_requests;
create policy payout_change_requests_read
on public.payout_change_requests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.has_gym_role(gym_id, array['gym_owner', 'manager']::public.user_role[])
);

drop policy if exists support_tickets_platform_all on public.support_tickets;
create policy support_tickets_platform_all
on public.support_tickets
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists ibd_self_insert on public.instructor_bank_details;
drop policy if exists ibd_self_select on public.instructor_bank_details;
drop policy if exists ibd_self_update on public.instructor_bank_details;

drop policy if exists reminder_logs_select_staff on public.reminder_logs;
drop policy if exists reminder_logs_staff_select on public.reminder_logs;
create policy reminder_logs_select_staff
on public.reminder_logs
for select
to authenticated
using (
  exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = reminder_logs.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
);

drop policy if exists reminder_logs_staff_insert on public.reminder_logs;
create policy reminder_logs_staff_insert
on public.reminder_logs
for insert
to authenticated
with check (
  exists (
    select 1 from public.gym_staff_links s
    where s.gym_id = reminder_logs.gym_id
      and s.user_id = (select auth.uid())
      and s.is_active is true
  )
);
