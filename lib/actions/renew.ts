'use server';

import { requireMember } from '@/lib/auth/dal';
import { requestOrigin } from '@/lib/request-origin';
import { createClient } from '@/lib/supabase/server';
import { initTransaction } from '@/lib/paystack';
import { offersTrainer, planTotalKobo } from '@/lib/plan-addon';
import { isOfflineGym } from '@/lib/gym-status';

export type RenewResult = { ok: true; url: string } | { ok: false; error: string };

// Start a Paystack checkout for a renewal. Validates the plan belongs to the
// member's gym, initializes a transaction, and returns the authorization URL
// for the client to redirect to. The webhook records the payment + extends
// the subscription once Paystack confirms (charge.success).
//
// `withTrainer` is the member's opt-in to the plan's private-trainer add-on.
// It's a request, not an instruction: the plan row decides whether the add-on
// exists and what it costs, so a client that asks for a trainer on a plan that
// doesn't offer one simply pays the plan price.
export async function startRenewal(planId: string, withTrainer = false): Promise<RenewResult> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  const { user, gym } = await requireMember();
  // Never open a checkout for a gym the platform has switched off. `subaccount`
  // below routes the split straight to the gym's own bank, so without this a
  // suspended tenant kept taking real money — and GymFlow would owe the member
  // either a membership it has disabled or a refund. Checked before the plan
  // lookup: the answer doesn't depend on which plan was asked for.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not accepting payments right now. Please contact the gym.' };
  }
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from('membership_plans')
    .select('id, name, price, duration_days, duration_months, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gym.id).eq('is_active', true)
    .maybeSingle();
  if (!plan) return { ok: false, error: 'Plan not found.' };

  const trainerAddon = withTrainer && offersTrainer(plan);
  const amountKobo = planTotalKobo(plan, trainerAddon);

  // The host the member is ON, not the apex: sessions are host-scoped, so a
  // callback to gymflow.ng from a member browsing <gym>.gymflow.ng arrives
  // signed out and bounces them to the login page after they've paid.
  const site = await requestOrigin();
  const txParams = {
    email: user.email ?? '',
    amountKobo,
    metadata: {
      member_id: user.id, gym_id: gym.id, plan_id: plan.id,
      duration_days: plan.duration_days, duration_months: plan.duration_months,
      trainer_addon: trainerAddon,
      expected_amount_kobo: amountKobo,
      kind: 'membership_renewal',
    },
    callbackUrl: site ? `${site}/dashboard/renew/callback` : undefined,
    subaccount: (gym.paystack_subaccount_code ?? '').trim() || null,
  };
  let res = await initTransaction(txParams);
  // If the stored subaccount code is stale/invalid at Paystack, retry without
  // it so the member can still pay (funds land in the platform account and the
  // gym owner is notified to reconnect payouts).
  if (!res.ok && txParams.subaccount && /invalid.*subaccount/i.test(res.error)) {
    res = await initTransaction({ ...txParams, subaccount: null });
  }
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}
