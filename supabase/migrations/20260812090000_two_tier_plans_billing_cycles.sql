-- Platform plan catalogue: three monthly tiers → two tiers × two billing cycles.
--
-- 'scale' is retired and its features fold into 'growth' (see lib/entitlements.ts),
-- so every gym on Scale moves to Growth and keeps exactly the features it had.
-- Monthly billing is retired too: new subscriptions are quarterly or annual.
-- Gyms already on a monthly Paystack plan keep billing on it until they
-- resubscribe — Paystack, not this column, decides what is charged.

-- Fold Scale into Growth before the constraint stops accepting it.
update public.gyms
set subscription_plan = 'growth',
    updated_at = now()
where subscription_plan = 'scale';

-- platform_payments.plan is a historical record of what was actually charged,
-- so 'scale' rows there are left alone on purpose.

alter table public.gyms
  drop constraint if exists gyms_subscription_plan_valid;

alter table public.gyms
  add constraint gyms_subscription_plan_valid
  check (subscription_plan is null or subscription_plan in ('starter', 'growth'))
  not valid;

alter table public.gyms
  validate constraint gyms_subscription_plan_valid;

-- Which cycle the gym's live Paystack subscription bills on. NULL means
-- "predates cycles" (a legacy monthly subscriber); lib/platform-plans.ts
-- normalizeCycle() estimates those as quarterly for display/MRR only.
alter table public.gyms
  add column if not exists subscription_billing_cycle text;

alter table public.gyms
  drop constraint if exists gyms_subscription_billing_cycle_valid;

alter table public.gyms
  add constraint gyms_subscription_billing_cycle_valid
  check (subscription_billing_cycle is null or subscription_billing_cycle in ('quarterly', 'annually'))
  not valid;

alter table public.gyms
  validate constraint gyms_subscription_billing_cycle_valid;
