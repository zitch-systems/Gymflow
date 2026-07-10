-- Membership freeze: explicit date window + per-gym member-self-freeze policy.
--
-- Builds on 20260705_membership_freeze.sql, which added the staff-approved
-- freeze flow (paused_at / pause_reason on member_subscriptions + memberships).
--
-- This migration:
--   1. Adds gyms.member_freeze_enabled — when false, members can no longer
--      request a freeze from the member app (staff can still freeze manually).
--   2. Adds pause_start / pause_end date columns to member_subscriptions and
--      memberships so a freeze records the window it covers (from → to). The
--      resume credit is computed from this window instead of guessing from the
--      wall-clock time a staff member happened to click "resume".
--   3. Extends the sync triggers so the two date columns move both directions
--      between memberships and member_subscriptions.
--
-- Idempotent. Safe to re-run.

-- 1) Per-gym policy: are members allowed to request a freeze themselves?
alter table public.gyms
  add column if not exists member_freeze_enabled boolean not null default true;

-- 2) Freeze window on both membership tables.
alter table public.member_subscriptions
  add column if not exists pause_start date,
  add column if not exists pause_end date;

alter table public.memberships
  add column if not exists pause_start date,
  add column if not exists pause_end date;

-- 3) Recreate the sync triggers carrying the two new columns. Kept in one place
--    so the definitions match 20260705 exactly aside from pause_start/pause_end.

create or replace function public.sync_subs_to_memberships()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if current_setting('app.syncing_memberships', true) = 'true' then
    return new;
  end if;

  perform set_config('app.syncing_memberships', 'true', true);

  if tg_op = 'INSERT' then
    insert into memberships (
      id, gym_id, member_id, plan_id, start_date, end_date,
      status, auto_debit_enabled, payment_method,
      paused_at, pause_reason, pause_start, pause_end,
      created_at, updated_at
    ) values (
      new.id, new.gym_id, new.member_id, new.plan_id, new.start_date, new.end_date,
      new.status, coalesce(new.auto_debit_enabled, false), coalesce(new.payment_method, 'card'),
      new.paused_at, new.pause_reason, new.pause_start, new.pause_end,
      new.created_at, now()
    )
    on conflict (id) do update set
      status = excluded.status,
      end_date = excluded.end_date,
      paused_at = excluded.paused_at,
      pause_reason = excluded.pause_reason,
      pause_start = excluded.pause_start,
      pause_end = excluded.pause_end,
      updated_at = now();

  elsif tg_op = 'UPDATE' then
    update memberships set
      status = new.status,
      end_date = new.end_date,
      plan_id = new.plan_id,
      paused_at = new.paused_at,
      pause_reason = new.pause_reason,
      pause_start = new.pause_start,
      pause_end = new.pause_end,
      updated_at = now()
    where id = new.id;
  end if;

  perform set_config('app.syncing_memberships', 'false', true);
  return new;
end;
$function$;

create or replace function public.sync_memberships_to_subs()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if current_setting('app.syncing_memberships', true) = 'true' then
    return new;
  end if;

  perform set_config('app.syncing_memberships', 'true', true);

  if tg_op = 'INSERT' then
    insert into member_subscriptions (
      id, gym_id, member_id, plan_id, start_date, end_date,
      status, auto_debit_enabled, payment_method,
      paused_at, pause_reason, pause_start, pause_end,
      created_at, updated_at
    ) values (
      new.id, new.gym_id, new.member_id, new.plan_id, new.start_date, new.end_date,
      new.status, coalesce(new.auto_debit_enabled, false), coalesce(new.payment_method, 'card'),
      new.paused_at, new.pause_reason, new.pause_start, new.pause_end,
      new.created_at, new.updated_at
    )
    on conflict (id) do update set
      status = excluded.status,
      end_date = excluded.end_date,
      paused_at = excluded.paused_at,
      pause_reason = excluded.pause_reason,
      pause_start = excluded.pause_start,
      pause_end = excluded.pause_end,
      updated_at = now();

  elsif tg_op = 'UPDATE' then
    update member_subscriptions set
      status = new.status,
      end_date = new.end_date,
      plan_id = new.plan_id,
      auto_debit_enabled = coalesce(new.auto_debit_enabled, false),
      paused_at = new.paused_at,
      pause_reason = new.pause_reason,
      pause_start = new.pause_start,
      pause_end = new.pause_end,
      updated_at = now()
    where id = new.id;
  end if;

  perform set_config('app.syncing_memberships', 'false', true);
  return new;
end;
$function$;
