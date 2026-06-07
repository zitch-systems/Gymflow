-- S9: Drop three RLS INSERT policies that used `WITH CHECK (true)`, which
-- effectively bypassed row-level security and let any caller (anon included)
-- INSERT into the table.
--
-- All three tables are written by server-side code only:
--   - reminder_logs: written by /api/cron/expiry-reminders via createAdminClient()
--   - client_errors: not currently written by any code (verified via grep)
--   - export_logs:   not currently written by any code (verified via grep)
--
-- The service-role client bypasses RLS, so dropping these permissive policies
-- does not affect the cron or any future server-side writer. SELECT policies
-- are preserved (staff/admin can still read the logs via the admin UI).

DROP POLICY IF EXISTS reminder_logs_insert_function ON public.reminder_logs;
DROP POLICY IF EXISTS client_errors_insert         ON public.client_errors;
DROP POLICY IF EXISTS export_logs_insert_service   ON public.export_logs;
