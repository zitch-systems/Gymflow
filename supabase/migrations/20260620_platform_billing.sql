-- Platform (gym → GymFlow) SaaS billing via Paystack Subscriptions.
--
-- The gyms table already carries subscription_status (trial/active/past_due/
-- cancelled), subscription_plan and trial_ends_at. Add the Paystack linkage +
-- the paid-through date so recurring charges can be matched back to a gym and
-- the admin surface can be gated when a gym hasn't paid.
alter table public.gyms
  add column if not exists paystack_subscription_code text,
  add column if not exists paystack_customer_code text,
  add column if not exists subscription_current_period_end timestamptz;

-- Idempotency for the webhook: one platform_payments row per Paystack charge
-- reference (the webhook + checkout callback both fulfill, and Paystack retries).
create unique index if not exists platform_payments_reference_unique
  on public.platform_payments (paystack_reference)
  where paystack_reference is not null;

-- Fast lookup when a recurring charge.success / subscription.* event only gives
-- us the Paystack subscription or customer code (no gym_id in metadata).
create index if not exists gyms_paystack_subscription_code_idx
  on public.gyms (paystack_subscription_code) where paystack_subscription_code is not null;
create index if not exists gyms_paystack_customer_code_idx
  on public.gyms (paystack_customer_code) where paystack_customer_code is not null;
