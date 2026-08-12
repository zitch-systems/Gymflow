// Platform (gym → GymFlow) SaaS plan catalog + billing-state logic.
// Pure module — safe to import from server or client. Amounts mirror the public
// pricing page (app/pricing/page.tsx); keep them in sync.
//
// Two tiers × two billing cycles = four Paystack Plans. GymFlow does not bill
// monthly: the shortest commitment is a quarter, which is what the Paystack
// Plan interval is set to. Every price below MUST match the amount on the
// Paystack Plan named by its planCodeEnv (see .env.example).

export type PlanTier = 'starter' | 'growth';

// Paystack Plan intervals we use. 'annually' is Paystack's own spelling — it is
// sent to their API verbatim, so don't "fix" it to 'annual'.
export type BillingCycle = 'quarterly' | 'annually';

export type PlanPrice = {
  cycle: BillingCycle;
  // Charged once per cycle, in kobo (naira × 100). Also sent as `amount` to
  // /transaction/initialize, which requires one even alongside a plan code —
  // Paystack charges the Plan's own amount regardless, so a mismatch here
  // only mis-displays, it can't mis-charge.
  amountKobo: number;
  // Env var holding the Paystack Plan code (each created once in the Paystack
  // dashboard as a recurring NGN plan on this cycle's interval).
  planCodeEnv: string;
};

export type PlatformPlan = {
  tier: PlanTier;
  name: string;
  tagline: string;
  prices: Record<BillingCycle, PlanPrice>;
};

// How many months each cycle buys. Drives the paid-through date the webhook
// writes, so this is billing-critical, not cosmetic.
export const CYCLE_MONTHS: Record<BillingCycle, number> = { quarterly: 3, annually: 12 };

export const CYCLE_LABEL: Record<BillingCycle, string> = { quarterly: 'Quarterly', annually: 'Annual' };
export const CYCLE_SUFFIX: Record<BillingCycle, string> = { quarterly: '/quarter', annually: '/year' };

export const BILLING_CYCLES: BillingCycle[] = ['quarterly', 'annually'];

// What an owner gets by default, and what an unlabelled legacy row is assumed
// to be (see normalizeCycle).
export const DEFAULT_CYCLE: BillingCycle = 'quarterly';

export const PLATFORM_PLANS: Record<PlanTier, PlatformPlan> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    tagline: 'For single-location studios',
    prices: {
      quarterly: { cycle: 'quarterly', amountKobo: 3_799_900, planCodeEnv: 'PAYSTACK_PLAN_STARTER_QUARTERLY' },
      annually: { cycle: 'annually', amountKobo: 12_199_900, planCodeEnv: 'PAYSTACK_PLAN_STARTER_ANNUAL' },
    },
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    tagline: 'For multi-location gyms & classes',
    prices: {
      quarterly: { cycle: 'quarterly', amountKobo: 10_299_900, planCodeEnv: 'PAYSTACK_PLAN_GROWTH_QUARTERLY' },
      annually: { cycle: 'annually', amountKobo: 32_999_900, planCodeEnv: 'PAYSTACK_PLAN_GROWTH_ANNUAL' },
    },
  },
};

export const PLAN_TIERS = Object.keys(PLATFORM_PLANS) as PlanTier[];

export function isPlanTier(v: string): v is PlanTier {
  return v === 'starter' || v === 'growth';
}

export function isBillingCycle(v: string): v is BillingCycle {
  return v === 'quarterly' || v === 'annually';
}

// Coerce a stored/echoed cycle to a real one. Gyms that subscribed before
// cycles existed have NULL here and are still billing on their old monthly
// Paystack plan until they resubscribe; treating them as quarterly keeps every
// display and MRR figure finite rather than zero. It is an estimate, and the
// only place it can be wrong is reporting — the money is whatever Paystack
// actually charges.
export function normalizeCycle(v: string | null | undefined): BillingCycle {
  const s = (v ?? '').trim();
  return isBillingCycle(s) ? s : DEFAULT_CYCLE;
}

export function planPrice(tier: PlanTier, cycle: BillingCycle): PlanPrice {
  return PLATFORM_PLANS[tier].prices[cycle];
}

export function planAmountKobo(tier: PlanTier, cycle: BillingCycle): number {
  return planPrice(tier, cycle).amountKobo;
}

export function cycleMonths(cycle: BillingCycle): number {
  return CYCLE_MONTHS[cycle];
}

// Per-month cost of a cycle — for "≈₦12,666/mo" copy and for normalising MRR
// across gyms on different cycles. Never the amount charged.
export function monthlyEquivalentKobo(tier: PlanTier, cycle: BillingCycle): number {
  return Math.round(planAmountKobo(tier, cycle) / cycleMonths(cycle));
}

// How much cheaper a cycle is than the same tier's quarterly rate, per month,
// as a whole percent. Drives the "save 20%" badge; 0 for the quarterly cycle
// itself so callers can just hide the badge when it's falsy.
export function cycleSavingPct(tier: PlanTier, cycle: BillingCycle): number {
  const base = monthlyEquivalentKobo(tier, DEFAULT_CYCLE);
  if (cycle === DEFAULT_CYCLE || base <= 0) return 0;
  return Math.round((1 - monthlyEquivalentKobo(tier, cycle) / base) * 100);
}

// ── Billing state ──────────────────────────────────────────────────────────
// Derived from gyms.subscription_status + trial_ends_at + the paid-through date
// (subscription_current_period_end). The DB enum can't express the time-derived
// cases, so we compute them:
//   • trial_expired — status 'trial' but the window has lapsed (blocked)
//   • cancelling    — cancelled but still inside the paid period (NOT blocked —
//                     access is kept until period end, as promised in the UI)
//   • suspended     — past_due AND the paid period has lapsed (blocked)
// past_due while still inside the paid period is a grace window (NOT blocked).
// isBlocked() is what gates the admin console.

export type BillingState = 'trial' | 'active' | 'past_due' | 'cancelling' | 'trial_expired' | 'cancelled' | 'suspended';

export type GymBillingFields = {
  subscription_status: string | null;
  trial_ends_at: string | null;
  subscription_current_period_end?: string | null;
};

export function gymBillingState(gym: GymBillingFields, now: number = Date.now()): BillingState {
  const status = gym.subscription_status ?? 'trial';
  const periodEnd = gym.subscription_current_period_end ? new Date(gym.subscription_current_period_end).getTime() : null;
  const inPaidPeriod = periodEnd !== null && periodEnd > now;

  if (status === 'active') return 'active';
  // Cancelled / payment-failed gyms keep access until the period they paid for
  // ends; only then are they blocked.
  if (status === 'cancelled') return inPaidPeriod ? 'cancelling' : 'cancelled';
  if (status === 'past_due') return inPaidPeriod ? 'past_due' : 'suspended';
  // status === 'trial' (or unknown): expired once the window passes.
  const ends = gym.trial_ends_at ? new Date(gym.trial_ends_at).getTime() : null;
  if (ends !== null && ends < now) return 'trial_expired';
  return 'trial';
}

// Hard-block the admin console: the gym must (re)subscribe before continuing.
export function isBlocked(state: BillingState): boolean {
  return state === 'trial_expired' || state === 'cancelled' || state === 'suspended';
}
