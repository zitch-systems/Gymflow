-- Make gym_payout_accounts' privileges explicit and portable.
--
-- The original 20260713_gym_payout_accounts.sql created the table + RLS but
-- relied on Supabase's default-privileges to grant the API roles access. That
-- holds on the hosted project (prod already has these grants) but NOT on a
-- plain Postgres — a fresh env or the test harness got the table with no grants,
-- so every authenticated query hit "permission denied for table". Every other
-- table migration (see checkin_codes) grants explicitly; match that so the
-- migration is self-contained. RLS still restricts rows to the gym's own
-- owner/manager (and platform admins) — grants only open the door; policies
-- decide who walks through. Idempotent: GRANT is a no-op where already present.
grant SELECT, INSERT, UPDATE, DELETE on public.gym_payout_accounts to authenticated;
grant SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE on public.gym_payout_accounts to service_role;
