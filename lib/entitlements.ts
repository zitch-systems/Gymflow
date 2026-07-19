// Plan entitlements — which product features each platform tier includes.
//
// The matrix mirrors the public pricing page (app/pricing/page.tsx); keep them
// in sync. Pure module (no I/O), safe to import from server or client.
//
// This is the single source of truth for "can this gym use feature X?". Gates
// read it via `gymHasFeature(gym, feature)`; UI reads `featuresFor(tier)` to
// show what a plan includes / what an upgrade unlocks. Enforcement points are
// intentionally thin wrappers over this so the policy lives in one place.

import type { PlanTier } from '@/lib/platform-plans';
import { isPlanTier } from '@/lib/platform-plans';

export type Feature =
  | 'qr_checkin'
  | 'paystack_subscriptions'
  | 'email_reminders'
  | 'class_scheduling'
  | 'whatsapp_reminders'
  | 'analytics_exports'
  | 'multi_gym'
  | 'instructor_payouts'
  | 'priority_support';

// Ascending capability order — a tier includes every feature at or below its
// rank ("Everything in Starter/Growth" on the pricing page).
const TIER_RANK: Record<PlanTier, number> = { starter: 0, growth: 1, scale: 2 };

// The minimum tier that unlocks each feature (from the pricing matrix).
const FEATURE_MIN_TIER: Record<Feature, PlanTier> = {
  // Starter and up
  qr_checkin: 'starter',
  paystack_subscriptions: 'starter',
  email_reminders: 'starter',
  // Growth and up — "Everything in Starter" + these
  class_scheduling: 'growth',
  whatsapp_reminders: 'growth',
  analytics_exports: 'growth',
  // Scale only — "Everything in Growth" + these
  multi_gym: 'scale',
  instructor_payouts: 'scale',
  priority_support: 'scale',
};

// A gym's effective tier. subscription_plan is the tier string; anything
// unrecognized (null / legacy) falls back to the most generous entry tier so a
// mis-set value never silently strips a paying gym of features — the billing
// system, not this map, is the authority on whether they've actually paid.
export function tierOf(gym: { subscription_plan: string | null }): PlanTier {
  return isPlanTier(gym.subscription_plan ?? '') ? (gym.subscription_plan as PlanTier) : 'starter';
}

export function tierHasFeature(tier: PlanTier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

export function gymHasFeature(gym: { subscription_plan: string | null }, feature: Feature): boolean {
  return tierHasFeature(tierOf(gym), feature);
}

// Every feature a tier includes — for UI ("what's in your plan").
export function featuresFor(tier: PlanTier): Feature[] {
  return (Object.keys(FEATURE_MIN_TIER) as Feature[]).filter((f) => tierHasFeature(tier, f));
}

// The lowest tier that unlocks a feature — for upgrade prompts ("upgrade to X").
export function requiredTier(feature: Feature): PlanTier {
  return FEATURE_MIN_TIER[feature];
}
