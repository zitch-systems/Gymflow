-- Member-controlled notification preferences (NDPR §2.1 'consent, withdrawal,
-- opt-out'). Two boolean columns on profiles default to true so existing
-- members keep receiving notifications until they opt out.
--
-- Transactional notifications (you paid → receipt) always send regardless of
-- these flags. Reminder / dunning / promotional channels honour them:
--   - auto-debit success / failure
--   - expiry reminders at 7/3/1 days + the expired notice
--
-- The send code (lib/email.ts, lib/whatsapp.ts) doesn't read these directly;
-- callers (cron + verify routes) select them in their existing profile join
-- and skip the send-function call when false. That avoids an extra DB round-
-- trip per send.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_whatsapp boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notification_email IS
  'Member consent to receive reminder/dunning emails. true by default for existing rows; user-controlled via /dashboard/profile. Transactional emails ignore this flag.';
COMMENT ON COLUMN public.profiles.notification_whatsapp IS
  'Member consent to receive reminder/dunning WhatsApp messages. true by default; user-controlled via /dashboard/profile. Transactional WA messages ignore this flag.';
