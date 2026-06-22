-- Tighten over-permissive member self-service write policies.
--
-- Found during the live-DB readiness audit (2026-06-20): the `authenticated`
-- role holds column-level UPDATE on all columns of these tables, so the row
-- policies below were the only boundary — and they let a member rewrite their
-- own financial rows directly via the PostgREST API (the app never does this,
-- but the public anon key + a user JWT can). All legitimate writes go through
-- staff policies (has_gym_role) or the service-role webhook, which bypass RLS.

-- 1) CRITICAL — a member could PATCH member_subscriptions.end_date/status/plan_id
--    for member_id = auth.uid() and grant themselves free, unlimited membership.
--    No member self-update path is legitimate; renewals are service-role (webhook)
--    and staff edits use msub_update_staff. Remove the self-update policy.
drop policy if exists "msub_update_self" on public.member_subscriptions;

-- 2) MEDIUM — a member could flip is_active/status on their own membership link
--    (e.g. reactivate a suspended membership). Link lifecycle is staff/service-role
--    managed (gml_update_staff + provisioning); remove the self-update policy.
drop policy if exists "gml_update_self" on public.gym_member_links;

-- 3) LOW/MEDIUM — the notifications self-update policy is all-column, so a member
--    could rewrite title/body/type/gym_id/metadata of their own notifications.
--    Members only ever need to toggle read state. Keep the row policy but restrict
--    the writable columns at the grant level (staff INSERT notifications; they do
--    not UPDATE them, so narrowing authenticated's UPDATE columns is safe).
revoke update on public.notifications from authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;
