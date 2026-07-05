-- Membership freeze — staff-approved flow.
--
-- Existing schema has memberships.pause_reason / paused_at columns and the
-- subscription_status enum includes 'paused' + 'pause_requested', but nothing
-- was wired up. This migration:
--   1. Allows 'pause_requested' in the status check constraint on both
--      memberships and member_subscriptions (previously only 'paused' was).
--   2. Adds paused_at + pause_reason to member_subscriptions (the primary
--      table the app reads from) so the freeze fields sit on the same row.
--   3. Extends the sync triggers so freeze state moves both directions between
--      memberships and member_subscriptions (they were only syncing
--      status/end_date/plan_id/auto_debit_enabled).
--
-- Idempotent. Safe to re-run.

-- 1) Allow 'pause_requested' in status checks.
alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add constraint memberships_status_check
  check (status = any (array['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text, 'pause_requested'::text]));

alter table public.member_subscriptions drop constraint if exists member_subscriptions_status_check;
alter table public.member_subscriptions add constraint member_subscriptions_status_check
  check (status = any (array['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text, 'pause_requested'::text]));

-- 2) Mirror freeze columns onto member_subscriptions.
alter table public.member_subscriptions
  add column if not exists paused_at timestamp with time zone,
  add column if not exists pause_reason text;

-- 3) Extend the sync triggers. Recreated wholesale so the definitions stay in
--    one place and match the baseline exactly aside from the two new columns.

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
      paused_at, pause_reason,
      created_at, updated_at
    ) values (
      new.id, new.gym_id, new.member_id, new.plan_id, new.start_date, new.end_date,
      new.status, coalesce(new.auto_debit_enabled, false), coalesce(new.payment_method, 'card'),
      new.paused_at, new.pause_reason,
      new.created_at, now()
    )
    on conflict (id) do update set
      status = excluded.status,
      end_date = excluded.end_date,
      paused_at = excluded.paused_at,
      pause_reason = excluded.pause_reason,
      updated_at = now();

  elsif tg_op = 'UPDATE' then
    update memberships set
      status = new.status,
      end_date = new.end_date,
      plan_id = new.plan_id,
      paused_at = new.paused_at,
      pause_reason = new.pause_reason,
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
      paused_at, pause_reason,
      created_at, updated_at
    ) values (
      new.id, new.gym_id, new.member_id, new.plan_id, new.start_date, new.end_date,
      new.status, coalesce(new.auto_debit_enabled, false), coalesce(new.payment_method, 'card'),
      new.paused_at, new.pause_reason,
      new.created_at, new.updated_at
    )
    on conflict (id) do update set
      status = excluded.status,
      end_date = excluded.end_date,
      paused_at = excluded.paused_at,
      pause_reason = excluded.pause_reason,
      updated_at = now();

  elsif tg_op = 'UPDATE' then
    update member_subscriptions set
      status = new.status,
      end_date = new.end_date,
      plan_id = new.plan_id,
      auto_debit_enabled = coalesce(new.auto_debit_enabled, false),
      paused_at = new.paused_at,
      pause_reason = new.pause_reason,
      updated_at = now()
    where id = new.id;
  end if;

  perform set_config('app.syncing_memberships', 'false', true);
  return new;
end;
$function$;
