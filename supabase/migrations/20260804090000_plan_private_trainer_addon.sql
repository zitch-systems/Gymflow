-- Optional private-trainer add-on on a membership plan.
--
-- A gym setting its prices can now offer a private trainer alongside a plan:
-- the add-on carries its own price, and the member decides at checkout whether
-- to take it. The plan price stays what it always was — the add-on is added on
-- top — so existing plans and every recorded payment keep their meaning.
--
--   membership_plans.trainer_addon_enabled — does this plan offer the add-on
--   membership_plans.trainer_addon_price   — the extra charge (0 = bundled free)
--   member_subscriptions.trainer_addon     — did THIS member opt in
--
-- paystack_plan_code_trainer is the auto-renew counterpart of the existing
-- paystack_plan_code. A Paystack Plan pins one recurring amount, so a member who
-- auto-renews WITH the trainer needs a second Paystack Plan at the combined
-- amount; reusing the base code would silently bill them the plan price alone
-- and hand them the trainer for free every cycle after the first.
--
-- Gym assignment of an actual instructor stays in instructor_subscriptions,
-- which already models member ↔ instructor and feeds coach earnings/payouts.
-- Nothing here grants new write access: instructor_subscriptions remains
-- service-role-only (20260801120000_lock_instructor_subscriptions_writes.sql).
--
-- Additive + idempotent.

alter table public.membership_plans
  add column if not exists trainer_addon_enabled boolean not null default false,
  add column if not exists trainer_addon_price numeric(12,2) not null default 0,
  add column if not exists paystack_plan_code_trainer text;

alter table public.member_subscriptions
  add column if not exists trainer_addon boolean not null default false;

-- A negative add-on would subtract from the plan price at checkout. The app
-- clamps before it ever writes; this is the backstop that makes it impossible.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'membership_plans_trainer_addon_price_check'
      and conrelid = 'public.membership_plans'::regclass
  ) then
    alter table public.membership_plans
      add constraint membership_plans_trainer_addon_price_check
      check (trainer_addon_price >= 0);
  end if;
end $$;

comment on column public.membership_plans.trainer_addon_enabled is 'Gym offers an optional private trainer with this plan. The member chooses at checkout; it is never forced on them.';
comment on column public.membership_plans.trainer_addon_price is 'Extra charge added to the plan price when the member takes the private trainer. 0 means the trainer is included in the plan price at no extra cost.';
comment on column public.membership_plans.paystack_plan_code_trainer is 'Paystack Plan code for the plan-plus-trainer recurring amount. Separate from paystack_plan_code because a Paystack Plan fixes one amount — see lib/actions/member-billing.ts ensurePlanCode.';
comment on column public.member_subscriptions.trainer_addon is 'Member paid for the private-trainer add-on on this subscription. Set by the payment fulfillment path from the signed checkout snapshot; the gym then assigns a specific instructor (instructor_subscriptions).';
