-- Bank-account snapshot captured at the moment an admin pays a coach.
-- These are intentionally per-payout (not per-instructor) so the audit trail
-- shows exactly which account each transfer settled into. Coaches may change
-- banks; historical rows must keep the bank that was actually paid.
--
-- bank_name is denormalised from the Paystack bank list so the admin queue
-- can render "GTBank" instead of forcing a re-fetch of /bank just to render
-- a label. account_name is what Paystack's /bank/resolve returned — used
-- both for display and as the recipient name when creating the Paystack
-- transfer recipient.

ALTER TABLE public.instructor_payouts
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS account_name text;

COMMENT ON COLUMN public.instructor_payouts.bank_code IS
  'Paystack bank code (e.g. 058 for GTBank). Captured at payout time.';
COMMENT ON COLUMN public.instructor_payouts.bank_name IS
  'Human-readable bank name, denormalised from Paystack /bank at payout time.';
COMMENT ON COLUMN public.instructor_payouts.account_number IS
  'NUBAN, 10 digits. Captured at payout time so historical rows remain accurate.';
COMMENT ON COLUMN public.instructor_payouts.account_name IS
  'Account name returned by Paystack /bank/resolve at payout time.';
