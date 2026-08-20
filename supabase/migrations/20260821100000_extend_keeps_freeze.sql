-- Paying while frozen must not silently end the freeze.
--
-- extend_member_sub() (20260821090000) forced `status = 'active'` on every
-- extension. That was harmless while a payment could only ever meet an 'active'
-- row: grantMemberPeriod() reads status='active' and INSERTed otherwise, so a
-- frozen member's renewal simply created a second row.
--
-- member_subscriptions_one_live_idx (20260821093000) closed that door — 'paused'
-- and 'pause_requested' are in the live set, so the INSERT now fails with 23505
-- and grantMemberPeriod's recovery branch extends the FROZEN row instead. With
-- the unconditional flip that row came back active while still carrying
-- paused_at / pause_start / pause_end, and from there nothing could put it
-- right: resumeFreeze() requires status='paused' and approveFreeze() requires
-- 'pause_requested' (lib/actions/freeze.ts), so the frozen days the member is
-- owed were never credited to end_date and the member regained door access
-- before their freeze window ended.
--
-- So a freeze now survives being paid into: the period is still stacked onto
-- end_date (the money landed, the member is owed the time), the row stays
-- frozen, and Resume still credits the frozen days on top afterwards. Every
-- other status keeps the old behaviour, which is the case that motivated the
-- flip: a successful payment is exactly what should bring a past_due member
-- back.
--
-- PRODUCTION DATA: this replaces a function, touches no rows, and cannot fail
-- on existing data. Rows already half-written by the old behaviour (active with
-- a pause window still set) are NOT repaired here — the frozen days they are
-- owed are a judgement call for the gym, and the audit trail of the freeze is
-- intact. Idempotent.
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
         status = case when status in ('paused', 'pause_requested') then status else 'active' end,
         plan_id = coalesce(p_plan_id, plan_id),
         trainer_addon = coalesce(p_trainer_addon, trainer_addon),
         updated_at = now()
   where id = p_id
   returning end_date;
$$;

revoke execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function public.extend_member_sub(uuid, int, int, uuid, boolean) to authenticated, service_role;

comment on function public.extend_member_sub(uuid, int, int, uuid, boolean) is
  'Atomically stack one billing period onto a member subscription and return the new end_date. Leaves a frozen row (paused / pause_requested) frozen so the freeze can still be resumed or approved; every other status is set active. Returns null when no row was updated (wrong id, or RLS refused the caller).';
