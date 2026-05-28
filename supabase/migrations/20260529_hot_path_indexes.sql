-- Hot-path index audit — addresses regressions that show up at scale.
--
-- The base schema has 50+ indexes but several heavy filters in the request
-- and cron paths still degrade to single-column lookups + filter scans. The
-- additions below mirror the actual code's query shapes; every one is a CREATE
-- INDEX CONCURRENTLY-safe operation (we use IF NOT EXISTS for idempotency
-- across re-runs in the dashboard).
--
-- All indexes are partial / composite so the bytes/cache impact is minimal.

-- ── profiles ────────────────────────────────────────────────────────────
-- After we removed admin.auth.admin.listUsers() in favour of profiles email
-- lookup (inviteInstructor / adminOnboardMember / onboard-gym), every "user
-- already exists" path runs `.ilike('email', x).maybeSingle()`. Without an
-- index this is a sequential scan on auth.users.email lookups via the trigger
-- — fine at hundreds of profiles, terrible at hundreds of thousands.
-- lower(email) makes it function-index-compatible with ilike when one side is
-- already lowercase (every call site lowercases the email first).
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON public.profiles (lower(email));

-- ── memberships ────────────────────────────────────────────────────────
-- expiry-reminders filters on (status, end_date) for the 7/3/1-day windows
-- and the [today-3 ..] cutoff. Hit several times per cron run.
CREATE INDEX IF NOT EXISTS idx_memberships_status_end_date
  ON public.memberships (status, end_date);

-- Member-scoped active-subscription lookup (verify pay-ahead, dashboard,
-- subscription.ts) keys on (member_id, gym_id, status). Sub-second today,
-- a few ms at 100k members.
CREATE INDEX IF NOT EXISTS idx_memberships_member_gym_status
  ON public.memberships (member_id, gym_id, status);

-- Auto-debit cron: (status='active', auto_debit_enabled=true, end_date BETWEEN ...).
-- Partial index keeps it tiny and avoids the bool-column-equality penalty.
CREATE INDEX IF NOT EXISTS idx_memberships_auto_debit_due
  ON public.memberships (end_date)
  WHERE status = 'active' AND auto_debit_enabled = true;

-- ── payments ───────────────────────────────────────────────────────────
-- Auto-debit same-day idempotency guard:
--   .eq member_id .eq gym_id .eq payment_method='card' .eq payment_status='successful' .gte payment_date
-- Run on every row in the auto-debit batch, multiple times per day.
CREATE INDEX IF NOT EXISTS idx_payments_idempotency
  ON public.payments (member_id, gym_id, payment_date)
  WHERE payment_method = 'card' AND payment_status = 'successful';

-- Analytics + revenue rollups: gym + status + date range.
CREATE INDEX IF NOT EXISTS idx_payments_gym_status_date
  ON public.payments (gym_id, payment_status, payment_date);

-- ── check_ins ──────────────────────────────────────────────────────────
-- Cooldown query in checkin.ts: (member_id, gym_id, checked_in_at >= 2h ago).
-- Existing (gym_id, checked_in_at) helps the 7-day chart but not the
-- per-member cooldown — separate composite required.
CREATE INDEX IF NOT EXISTS idx_checkins_member_gym_time
  ON public.check_ins (member_id, gym_id, checked_in_at DESC);

-- ── gym_staff_links ────────────────────────────────────────────────────
-- RLS policies (`EXISTS (SELECT 1 FROM gym_staff_links WHERE gym_id = X AND
-- user_id = auth.uid() AND is_active)`) and getStaffRole both filter on the
-- same three columns. (gym_id) + (user_id) singletons exist; the composite
-- collapses both index scans into one.
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_gym_user_active
  ON public.gym_staff_links (gym_id, user_id, is_active);

-- requireInstructor additionally filters on role — keep this narrow partial.
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_instructor
  ON public.gym_staff_links (gym_id, user_id)
  WHERE role = 'instructor' AND is_active = true;

-- ── gyms ───────────────────────────────────────────────────────────────
-- platform-renewals cron: in (subscription_status IN (...)) AND trial_ends_at
-- BETWEEN windowStart AND today. Until there are thousands of gyms this is
-- whatever; pre-emptive composite costs us almost nothing.
CREATE INDEX IF NOT EXISTS idx_gyms_renewal_window
  ON public.gyms (subscription_status, trial_ends_at);

-- ── instructor_subscriptions ───────────────────────────────────────────
-- An existing partial index covers auto-renew lookups; add (member_id,
-- instructor_id, status) for the "do I have an active sub with this coach"
-- pattern on the member-instructor detail page.
CREATE INDEX IF NOT EXISTS idx_instructor_subs_member_instructor_status
  ON public.instructor_subscriptions (member_id, instructor_id, status);

-- ── platform_payments ──────────────────────────────────────────────────
-- The renewals cron does an idempotency check on paystack_reference (already
-- UNIQUE) — that's the only access pattern. The unique constraint provides
-- the index; nothing to add.

-- ── class_bookings ─────────────────────────────────────────────────────
-- Waitlist promotion picks the oldest waitlisted booking for a schedule/date.
-- (schedule_id, booking_date, status) composite shortens this.
CREATE INDEX IF NOT EXISTS idx_class_bookings_promote
  ON public.class_bookings (class_schedule_id, booking_date, status, booked_at);
