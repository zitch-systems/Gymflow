-- Idempotency guard for Paystack fulfillment.
--
-- On a successful payment Paystack BOTH redirects the member's browser to the
-- callback (/dashboard/renew/callback) AND fires the charge.success webhook
-- (/api/paystack/webhook), near-simultaneously. Both call fulfillCharge() with
-- the same reference. Without a unique constraint on the reference, the race
-- lets both pass the "already recorded?" pre-check, insert a payment row, and
-- extend the subscription twice.
--
-- This unique index makes the second writer's INSERT fail with SQLSTATE 23505,
-- which fulfillCharge() catches and treats as an idempotent no-op (so the
-- payment is recorded once and the membership extended once).
--
-- Partial index: fulfilled charges always set a non-null reference, and manual
-- admin payments use a unique MANUAL-<timestamp> reference, so only NULLs are
-- excluded (Postgres treats NULLs as distinct anyway).
--
-- Idempotent (IF NOT EXISTS). NOTE: if the table already contains duplicate
-- references from a pre-fix double-fulfillment, this will error — de-duplicate
-- those rows first, then re-run.
create unique index if not exists payments_paystack_reference_key
  on public.payments (paystack_reference)
  where paystack_reference is not null;
