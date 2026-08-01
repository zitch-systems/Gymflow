-- Lock instructor_subscriptions writes to the service role.
--
-- These rows are created and updated only by the service-role payment
-- fulfillment path — no application code writes them with a user-scoped client
-- (every reference in lib/ and app/ is a SELECT). The baseline, however, granted
-- INSERT/UPDATE/DELETE to `authenticated` and backed it with two permissive
-- self-policies:
--   • is_insert_self               — WITH CHECK only `member_id = auth.uid()`
--   • is_update_self_or_instructor — USING only, NO WITH CHECK (the classic
--                                    "USING reused as the write-check" hole)
--
-- Because lib/payout-balance.ts computes an instructor's withdrawable balance as
-- sum(instructor_subscriptions.amount_paid) filtered by (gym_id, instructor_id)
-- only, an instructor (who is also `authenticated`) could INSERT a row for
-- themselves with an arbitrary amount_paid and inflate their own payout balance
-- — which feeds real money out via requestPayout — and any member could write
-- rows scoped to a DIFFERENT gym (cross-tenant pollution of that gym's earnings
-- dashboards). No validate_* trigger guards this table, unlike check_ins /
-- class_bookings / checkin_codes.
--
-- Fix: revoke write privileges from anon + authenticated and drop the write
-- policies. SELECT is unchanged (grant + is_select_self_or_gym), so instructors
-- and members keep reading their own rows; the service role is unaffected (it
-- bypasses RLS and keeps its grants), so fulfillment continues to work.

revoke insert, update, delete on public.instructor_subscriptions from anon, authenticated;

drop policy if exists is_insert_self on public.instructor_subscriptions;
drop policy if exists is_update_self_or_instructor on public.instructor_subscriptions;
