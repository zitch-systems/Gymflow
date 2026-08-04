'use server';

import { requireMember } from '@/lib/auth/dal';
import { requestOrigin } from '@/lib/request-origin';
import { createClient } from '@/lib/supabase/server';
import { initTransaction } from '@/lib/paystack';
import { offersTrainer, planTotalKobo } from '@/lib/plan-addon';

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
  const res = await initTransaction({
    email: user.email ?? '',
    amountKobo,
    metadata: {
      member_id: user.id, gym_id: gym.id, plan_id: plan.id,
      duration_days: plan.duration_days, duration_months: plan.duration_months,
      // What the member chose to buy, so fulfillment can credit the add-on it
      // was actually paid for rather than inferring it from the amount.
      trainer_addon: trainerAddon,
      // Snapshot what THIS checkout was initialized to settle. Fulfillment
      // compares the signed Paystack event to this value, so a later plan-price
      // edit neither strands a valid charge nor permits an underpaid one.
      expected_amount_kobo: amountKobo,
      kind: 'membership_renewal',
    },
    callbackUrl: site ? `${site}/dashboard/renew/callback` : undefined,
    subaccount: gym.paystack_subaccount_code, // settle to the gym's bank when connected
  });
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}
