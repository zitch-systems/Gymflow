-- Coach bank details for automated payouts. Deliberately a SEPARATE table
-- rather than columns on profiles: account numbers are sensitive PII and
-- profiles is broadly readable (a user's own row, plus any gym-staff member
-- of a gym the user belongs to — see 20260524_rls_profiles.sql). Widening
-- profiles with account_number would expose every coach's bank account to
-- that whole staff-read surface. This table is readable ONLY by its owner
-- (and the service role, which the admin payout path uses).
--
-- One row per instructor: a bank account is personal, so even a coach who
-- works at multiple gyms has a single payout account. PK on instructor_id
-- enforces that and makes upsert-on-conflict trivial.

CREATE TABLE IF NOT EXISTS public.instructor_bank_details (
  instructor_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_code       text NOT NULL,
  bank_name       text NOT NULL,
  account_number  text NOT NULL,
  account_name    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.instructor_bank_details IS
  'Coach payout bank accounts. Owner-readable only (plus service role). account_name is what Paystack /bank/resolve returned at save time, so the admin payout flow trusts it without re-resolving.';

ALTER TABLE public.instructor_bank_details ENABLE ROW LEVEL SECURITY;

-- Clean slate so re-running is safe.
DROP POLICY IF EXISTS instructor_bank_details_select_own ON public.instructor_bank_details;
DROP POLICY IF EXISTS instructor_bank_details_insert_own ON public.instructor_bank_details;
DROP POLICY IF EXISTS instructor_bank_details_update_own ON public.instructor_bank_details;

-- A coach can read only their own bank account. Deliberately NO staff-read
-- policy: admins reach this via the service-role client in the payout flow.
CREATE POLICY instructor_bank_details_select_own ON public.instructor_bank_details
  FOR SELECT
  TO authenticated
  USING (instructor_id = auth.uid());

CREATE POLICY instructor_bank_details_insert_own ON public.instructor_bank_details
  FOR INSERT
  TO authenticated
  WITH CHECK (instructor_id = auth.uid());

CREATE POLICY instructor_bank_details_update_own ON public.instructor_bank_details
  FOR UPDATE
  TO authenticated
  USING (instructor_id = auth.uid())
  WITH CHECK (instructor_id = auth.uid());
