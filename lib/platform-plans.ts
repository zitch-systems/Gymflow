// Platform (gym → GymFlow) SaaS plan catalog + billing-state logic.
// Pure module — safe to import from server or client. Amounts mirror the public
// pricing page (app/pricing/page.tsx); keep them in sync.

export type PlanTier = 'starter' | 'growth' | 'scale';

export type PlatformPlan = {
  tier: PlanTier;
  name: string;
  // Display price, and the `amount` sent to /transaction/initialize because
  // that endpoint requires one even alongside a plan code. MUST match the
  // amount of the Paystack Plan referenced by planCodeEnv — Paystack charges
  // the plan's amount regardless of what we send, so a mismatch here only
  // mis-displays, it can't mis-charge.
  amountKobo: number; // naira × 100
  tagline: string;
  // Env var holding the Paystack Plan code (created once in the Paystack
  // dashboard as a recurring monthly NGN plan). Recurring billing needs it.
  planCodeEnv: string;
};

export const PLATFORM_PLANS: Record<PlanTier, PlatformPlan> = {
  starter: { tier: 'starter', name: 'Starter', amountKobo: 1_399_900, tagline: 'For single-location studios', planCodeEnv: 'PAYSTACK_PLAN_STARTER' },
  growth: { tier: 'growth', name: 'Growth', amountKobo: 3_799_900, tagline: 'For growing gyms & classes', planCodeEnv: 'PAYSTACK_PLAN_GROWTH' },
  scale: { tier: 'scale', name: 'Scale', amountKobo: 11_999_900, tagline: 'For multi-location operators', planCodeEnv: 'PAYSTACK_PLAN_SCALE' },
};

export const PLAN_TIERS = Object.keys(PLATFORM_PLANS) as PlanTier[];

export function isPlanTier(v: string): v is PlanTier {
  return v === 'starter' || v === 'growth' || v === 'scale';
}

export function planAmountKobo(tier: PlanTier): number {
  return PLATFORM_PLANS[tier].amountKobo;
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
