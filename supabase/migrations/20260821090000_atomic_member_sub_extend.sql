-- Make extending a membership a single atomic statement.
--
-- Three writers extended a subscription by reading end_date, adding the plan's
-- period in JavaScript and writing the result back:
--
--   lib/paystack-fulfill.ts      one-off card renewal (webhook + callback)
--   lib/member-sub-fulfill.ts    auto-debit recurring charge
--   lib/actions/admin-member.ts  staff recording a cash payment with "extend"
--
-- UNIQUE(paystack_reference) makes each Paystack reference idempotent, but two
-- DISTINCT references settling at the same instant are not the same reference.
-- Both readers saw the same end_date, both computed the same new one, and the
-- second UPDATE overwrote the first: two months paid, one month of access
-- granted. Nothing downstream catches it either — lib/reconcile.ts only checks
-- that every Paystack reference EXISTS locally, and both of them do.
--
-- extend_member_sub() closes that. The new end_date is derived from the row
-- itself inside one UPDATE, and under READ COMMITTED an UPDATE that meets a row
-- a concurrent transaction has just written re-reads the new version and
-- re-evaluates the SET expression against it. The second caller therefore
-- stacks its period onto the first caller's result instead of replacing it —
-- the same reason `set balance = balance + 100` is safe and a read-modify-write
-- of the same value is not.
--
-- SECURITY INVOKER (the default, spelled out because it is the point): this is
-- a transaction shape, not a privilege escalation. The service-role fulfillers
-- bypass RLS exactly as they did before, and the staff path still answers to
-- msub_update_staff. A SECURITY DEFINER version granted to `authenticated`
-- would hand every signed-in user a free extension on any subscription id they
-- could guess.
--
-- Idempotent.

-- One billing period after `p_from`, computed the way lib/plan-duration.ts
-- extendDate() computes it. This has to agree with the TypeScript to the day:
-- moving the arithmetic into SQL is only safe if it is the SAME arithmetic,
-- otherwise the fix silently reprices every renewal on the platform.
--
--   * duration_days wins whenever it is positive; months are used otherwise,
--     and never fewer than one (extendDate's Math.max(1, months ?? 1)).
--   * Months are added the way JavaScript's Date.setMonth() adds them: the
--     day-of-month is carried across and any overflow rolls forward into the
--     next month (31 Jan + 1 month = 3 Mar). Postgres' own
--     date + interval '1 month' CLAMPS instead (28 Feb), which would shorten
--     every renewal whose period ends on a long month's tail. The
--     first-of-month + months + (day - 1) form below reproduces the overflow.
create or replace function private.period_end(p_from date, p_days int, p_months int)
returns date
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_days, 0) > 0 then p_from + coalesce(p_days, 0)
    else (
      date_trunc('month', p_from::timestamp)
      + make_interval(months => greatest(1, coalesce(p_months, 1)))
      + make_interval(days => extract(day from p_from)::int - 1)
    )::date
  end;
$$;

revoke execute on function private.period_end(date, int, int) from public;
grant execute on function private.period_end(date, int, int) to authenticated, service_role;

-- Extend one subscription by one billing period and hand back the new end date.
--
-- greatest(end_date, current_date) is renewalBase(): stack onto the period
-- still running, otherwise start from today. It matches the JavaScript rule
-- (`end > now ? end : now`) case for case — a period that has already lapsed
-- loses to today, and a period ending TODAY also loses to today, because
-- midnight on the end date is already behind the clock by the time anyone pays.
--
-- status is set to 'active' because every caller is fulfilling money that just
-- landed: the auto-debit path already did this to recover a past_due member,
-- the staff path already did it, and the one-off path only ever selected active
-- rows, so this is a no-op there unless a dunning event flipped the row between
-- its read and this write — in which case a successful payment is exactly what
-- should flip it back.
--
-- plan_id and trainer_addon are optional: null means "leave what is there".
-- The auto-debit path writes them in its own earlier statement, the one-off
-- path re-states them on every renewal so a member who renews WITHOUT the
-- trainer stops being owed one.
create or replace function public.extend_member_sub(
  p_id uuid,
  p_days int,
  p_months int,
  p_plan_id uuid default null,
  p_trainer_addon boolean default null
)
returns date
language sql
security invoker
set search_path to 'public', 'pg_temp'
as $$
  update public.member_subscriptions
     set end_date = private.period_end(greatest(end_date, current_date), p_days, p_months),
         status = 'active',
         plan_id = coalesce(p_plan_id, plan_id),
         trainer_addon = coalesce(p_trainer_addon, trainer_addon),
         updated_at = now()
   where id = p_id
   returning end_date;
$$;

revoke execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) to authenticated, service_role;

comment on function public.extend_member_sub(uuid, int, int, uuid, boolean) is
  'Atomically stack one billing period onto a member subscription and return the new end_date. Returns null when no row was updated (wrong id, or RLS refused the caller).';
