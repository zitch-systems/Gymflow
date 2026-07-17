-- Pre-launch hardening. Two DB-layer fixes found by a final security/money
-- audit before go-live. Idempotent (drop/create, create index if not exists).

-- 1) BLOCKER — tenant takeover via gym_staff_links.
--    gym_staff_links_all was `for ALL to public` with a USING that includes
--    `user_id = auth.uid()` and NO explicit `with check`. Postgres reuses the
--    USING expression as the write-check when none is given, so the self branch
--    let ANY authenticated user INSERT a row granting themselves gym_owner on
--    ANY gym (user_id = their own uid satisfies the check; gym_id/role are
--    unconstrained), or UPDATE their own low-priv row up to gym_owner —
--    bypassing the app-layer guards in admin-staff.ts, which only run in the
--    server action, not the DB. requireStaff() reads gym_staff_links, so the
--    forged row is honoured immediately.
--
--    Every legitimate staff-link write in the app goes through the service-role
--    client (provisionOwner / provisionGym / inviteStaff / setStaffRole /
--    setStaffActive), which bypasses RLS — so restricting this policy to
--    owners/managers of the TARGET gym breaks no real flow. Self-read stays
--    available via gym_staff_links_select_own; there is no legitimate
--    user-client self-WRITE to drop.
drop policy if exists gym_staff_links_all on public.gym_staff_links;
create policy gym_staff_links_all on public.gym_staff_links as PERMISSIVE for ALL to public
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));

-- 2) One open payout per instructor per gym.
--    requestPayout() checks "no open payout" then inserts, with no DB guard, so
--    two concurrent requests (double-click / two tabs) both pass and insert two
--    'requested' rows for the same earnings; if staff approve both, payPayout()
--    (which claims a single row but did not re-check the balance) transfers real
--    money twice. This partial unique index makes a second open payout fail at
--    the DB; requestPayout catches the 23505 as "already in progress", and
--    payPayout now re-checks the balance as defence in depth.
create unique index if not exists instructor_payouts_one_open
  on public.instructor_payouts (gym_id, instructor_id)
  where status in ('requested', 'approved');
