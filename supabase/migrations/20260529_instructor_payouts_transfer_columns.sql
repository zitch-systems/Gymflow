-- Foundation for automated instructor payouts via Paystack Transfers.
-- Adds two columns to instructor_payouts:
--   paystack_transfer_code — set when a transfer is initiated (or correlated
--     from a manual dashboard transfer via metadata). The webhook handlers
--     match incoming transfer.success / transfer.failed / transfer.reversed
--     events on this column to flip the payout's status.
--   paystack_recipient_code — set the first time a coach gets paid;
--     persisted so subsequent payouts to the same coach reuse the same
--     Paystack recipient instead of creating duplicates.
--
-- Both nullable + default NULL — existing rows stay untouched. New rows
-- created by requestPayout() leave them null until admin processes the
-- payout (manual via the dashboard or, eventually, via a "Pay" button).
--
-- Index on paystack_transfer_code is partial — most rows will be NULL for
-- the foreseeable future, and the webhook only ever queries by the populated
-- value.

ALTER TABLE public.instructor_payouts
  ADD COLUMN IF NOT EXISTS paystack_transfer_code text,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code text;

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_transfer_code
  ON public.instructor_payouts (paystack_transfer_code)
  WHERE paystack_transfer_code IS NOT NULL;

COMMENT ON COLUMN public.instructor_payouts.paystack_transfer_code IS
  'Per-transfer Paystack identifier. Populated when a transfer is initiated; webhook handlers match transfer.success / transfer.failed / transfer.reversed events on this to flip the row status.';
COMMENT ON COLUMN public.instructor_payouts.paystack_recipient_code IS
  'Coach''s Paystack transfer-recipient code. Persisted so subsequent payouts to the same coach reuse one recipient instead of creating duplicates.';
