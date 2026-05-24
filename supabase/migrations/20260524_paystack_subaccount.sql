-- Paystack subaccount support for per-gym payment splitting.
--
-- Each gym registers their bank account; we create a Paystack subaccount
-- and store the code. Member payments are then initialised with
-- subaccount=<code> so Paystack splits the funds: gym gets the share, the
-- platform retains its commission via percentage_charge.

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code  text,
  ADD COLUMN IF NOT EXISTS bank_code                 text,
  ADD COLUMN IF NOT EXISTS bank_name                 text,
  ADD COLUMN IF NOT EXISTS account_number            text,
  ADD COLUMN IF NOT EXISTS account_name              text,
  ADD COLUMN IF NOT EXISTS platform_commission_pct   numeric(5,2) NOT NULL DEFAULT 5.00
    CHECK (platform_commission_pct BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_gyms_paystack_subaccount
  ON public.gyms(paystack_subaccount_code) WHERE paystack_subaccount_code IS NOT NULL;
