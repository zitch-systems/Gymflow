-- Coach teaching-availability days (JS getDay() ints, 0=Sun..6=Sat), saved
-- from coach Settings. profiles self-update RLS already covers it (the policy
-- blocks role escalation only). Idempotent.
alter table public.profiles add column if not exists availability jsonb;
