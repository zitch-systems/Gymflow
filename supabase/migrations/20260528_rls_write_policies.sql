-- RLS write-policy hardening — defense in depth for memberships, payments,
-- check_ins, and platform_payments. The app already routes authorized writes
-- through the service-role client (which bypasses RLS), but the public schema
-- had RLS enabled on these tables with only SELECT policies. That left two
-- footguns:
--   1. A future code path using the user-scoped (anon) client to write any
--      of these tables fails silently — Postgres denies the operation when no
--      policy permits it.
--   2. If someone later adds a permissive INSERT policy to memberships or
--      payments without thinking, a member could self-mint a paid-up
--      subscription. Make the intent explicit.
--
-- This migration adds:
--   - check_ins: a narrow self-INSERT policy (member_id = auth.uid()) so
--     authenticated self check-ins can be served without going through the
--     admin client. Staff manual check-in continues via the service role.
--   - platform_payments: explicit deny for INSERT/UPDATE on the authenticated
--     role. Webhook + verify routes use the service role.
--   - memberships, payments: intentionally NO permissive INSERT/UPDATE policy
--     for authenticated. We document the decision here so the next reviewer
--     doesn't add one by reflex.
--
-- Apply via the Supabase SQL editor, `supabase db push`, or MCP apply_migration.

-- ── check_ins: self-insert allowed, staff still goes through service role ──
DROP POLICY IF EXISTS checkins_insert_self ON public.check_ins;
CREATE POLICY checkins_insert_self ON public.check_ins
  FOR INSERT
  TO authenticated
  WITH CHECK (member_id = auth.uid());

-- ── platform_payments: explicit write deny for authenticated callers ──
DROP POLICY IF EXISTS platform_payments_no_insert ON public.platform_payments;
CREATE POLICY platform_payments_no_insert ON public.platform_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS platform_payments_no_update ON public.platform_payments;
CREATE POLICY platform_payments_no_update ON public.platform_payments
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ── memberships and payments: intentionally service-role-only for writes ──
-- A permissive policy here would let a member self-mint a paid subscription
-- (RLS can restrict rows but not columns). Keep writes service-role-only.
-- This block exists purely as documentation in the migration history; no
-- DDL is intended.

COMMENT ON TABLE public.memberships IS
  'Writes are intentionally service-role-only. Members must not self-INSERT or self-UPDATE — RLS cannot restrict which columns they edit (e.g. end_date, status), so allowing member writes would let them extend or activate their own subscription. Verify / cron / admin paths use createAdminClient.';

COMMENT ON TABLE public.payments IS
  'Writes are intentionally service-role-only. Authenticated INSERT would allow a member to forge a successful payment row. Verify / webhook / cron use createAdminClient.';
