// GymFlow platform plans — what a gym owner pays GymFlow for (distinct from the
// membership_plans a gym sells to its own members). Prices mirror the public
// marketing pricing page and are billed monthly. Stored on gyms.subscription_plan.

export type PlatformTier = 'starter' | 'growth' | 'scale';

export const PLATFORM_PLANS: {
  tier: PlatformTier; name: string; price: number; tagline: string; features: string[]; popular?: boolean;
}[] = [
  {
    tier: 'starter', name: 'Starter', price: 13999, tagline: 'For single-location studios',
    features: ['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
  },
  {
    tier: 'growth', name: 'Growth', price: 37999, tagline: 'For growing gyms & classes',
    features: ['Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders', 'Live analytics + exports'],
    popular: true,
  },
  {
    tier: 'scale', name: 'Scale', price: 119999, tagline: 'For multi-location operators',
    features: ['Everything in Growth', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support'],
  },
];

export function platformPlan(tier: string | null | undefined) {
  return PLATFORM_PLANS.find((p) => p.tier === tier) ?? null;
}
