'use server';

import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { initTransaction } from '@/lib/paystack';

export type RenewResult = { ok: true; url: string } | { ok: false; error: string };

// Start a Paystack checkout for a renewal. Validates the plan belongs to the
// member's gym, initializes a transaction, and returns the authorization URL
// for the client to redirect to. The webhook records the payment + extends
// the subscription once Paystack confirms (charge.success).
export async function startRenewal(planId: string): Promise<RenewResult> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from('membership_plans')
    .select('id, name, price, duration_months')
    .eq('id', planId).eq('gym_id', gym.id).eq('is_active', true)
    .maybeSingle();
  if (!plan) return { ok: false, error: 'Plan not found.' };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const res = await initTransaction({
    email: user.email ?? '',
    amountKobo: Math.round(Number(plan.price) * 100),
    metadata: { member_id: user.id, gym_id: gym.id, plan_id: plan.id, duration_months: plan.duration_months, kind: 'membership_renewal' },
    callbackUrl: site ? `${site}/dashboard/renew/callback` : undefined,
  });
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}
