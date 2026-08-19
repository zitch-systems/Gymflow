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
  | 'ai_assistant'
  | 'analytics_exports'
  | 'multi_gym'
  | 'instructor_payouts'
  | 'instructor_portal'
  | 'member_app'
  | 'priority_support';

// Ascending capability order — a tier includes every feature at or below its
// rank ("Everything in Starter" on the pricing page).
const TIER_RANK: Record<PlanTier, number> = { starter: 0, growth: 1 };

// The minimum tier that unlocks each feature (from the pricing matrix).
const FEATURE_MIN_TIER: Record<Feature, PlanTier> = {
  // Starter and up
  qr_checkin: 'starter',
  paystack_subscriptions: 'starter',
  email_reminders: 'starter',
  // Growth only — "Everything in Starter" + these. Growth is the top tier, so
  // it carries what the retired Scale tier used to gate (multi-gym, payouts,
  // priority support); gyms migrated off Scale keep every feature they had.
  class_scheduling: 'growth',
  whatsapp_reminders: 'growth',
  ai_assistant: 'growth',
  analytics_exports: 'growth',
  multi_gym: 'growth',
  instructor_payouts: 'growth',
  // Starter is the gym's own admin portal only — the member-facing app and the
  // instructor portal are Growth-only surfaces, not just Growth-only features
  // within a surface everyone gets. Gated at the route group (app/(member)/layout.tsx,
  // app/(coach)/layout.tsx), not just in the entitlements-driven UI.
  instructor_portal: 'growth',
  member_app: 'growth',
  priority_support: 'growth',
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

// Actionable server-action error for a tier-gated feature. Enforcement points
// return this so a Starter gym sees WHY the button failed and where to fix it,
// instead of a generic error.
export function upgradeMessage(feature: Feature): string {
  const tier = requiredTier(feature);
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `This feature is part of the ${label} plan. Upgrade in Billing → Plans to use it.`;
}

// The lowest tier that unlocks a feature — for upgrade prompts ("upgrade to X").
export function requiredTier(feature: Feature): PlanTier {
  return FEATURE_MIN_TIER[feature];
}
