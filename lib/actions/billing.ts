'use server';

import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { initTransaction } from '@/lib/paystack';
import { platformPlan } from '@/lib/platform-plans';

export type BillingResult = { ok: true; url: string } | { ok: false; error: string };

// Start a Paystack checkout for the gym's OWN GymFlow subscription (flow ①:
// gym → GymFlow). No subaccount — this is the platform's revenue and settles to
// the platform account. The webhook/callback mark the gym's subscription active.
export async function startPlatformSubscription(tier: string): Promise<BillingResult> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Billing is not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  const plan = platformPlan(tier);
  if (!plan) return { ok: false, error: 'Unknown plan.' };

  const { user, gym } = await requireStaff(MANAGER_ROLES);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const res = await initTransaction({
    email: user.email ?? '',
    amountKobo: Math.round(plan.price * 100),
    metadata: { kind: 'platform_subscription', gym_id: gym.id, tier: plan.tier, duration_months: 1 },
    callbackUrl: site ? `${site}/admin/billing/callback` : undefined,
  });
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}
