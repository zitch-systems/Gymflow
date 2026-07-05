-- Member auto-recurring billing (self-serve + staff override + dunning).
--
-- Wires Paystack Subscriptions to individual members. Previously the member
-- flow was one-off charges only (lib/actions/renew.ts → initTransaction). This
-- migration prepares the schema; app-layer wiring goes in lib/member-billing
-- and lib/member-sub-fulfill.
--
-- Changes:
--   1. membership_plans.paystack_plan_code — lazy-created Paystack Plan
--      code keyed to this membership plan. Created on first opt-in.
--   2. member_subscriptions.status allows 'past_due' — the dunning window
--      after invoice.payment_failed but before subscription.not_renew.
--   3. member_subscriptions.paystack_customer_code, .paystack_email_token —
--      needed to disable a subscription (Paystack requires both).
--
-- Idempotent.

alter table public.membership_plans
  add column if not exists paystack_plan_code text;

alter table public.member_subscriptions
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_email_token text;

-- Extend status check to include 'past_due'. Rebuild in place so the constraint
-- name stays predictable.
alter table public.member_subscriptions drop constraint if exists member_subscriptions_status_check;
alter table public.member_subscriptions add constraint member_subscriptions_status_check
  check (status = any (array[
    'active'::text, 'expired'::text, 'cancelled'::text,
    'paused'::text, 'pause_requested'::text, 'past_due'::text
  ]));

-- Mirror on memberships to keep the two tables in constraint-lockstep with each
-- other (they're kept in sync by triggers).
alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add constraint memberships_status_check
  check (status = any (array[
    'active'::text, 'expired'::text, 'cancelled'::text,
    'paused'::text, 'pause_requested'::text, 'past_due'::text
  ]));

-- Fast lookup by paystack_subscription_code (webhooks arrive with just the
-- code and need to find the member sub). Partial index — most rows have NULL
-- until a member opts into auto-renew.
create index if not exists idx_member_subscriptions_paystack_subscription_code
  on public.member_subscriptions (paystack_subscription_code)
  where paystack_subscription_code is not null;
