import type { SupabaseClient } from '@supabase/supabase-js';
import { initTransaction } from '@/lib/paystack';
import { gymCommission } from '@/lib/paystack-payloads';
import { offersTrainer, planTotalKobo } from '@/lib/plan-addon';
import { isOfflineGym } from '@/lib/gym-status';
import type { Database } from '@/lib/database.types';

// Opening a Paystack checkout for a membership renewal. Shared by the web
// Server Action (lib/actions/renew.ts) and the Android app's /api/app/renew —
// the two differ only in where Paystack sends the member afterwards, so that is
// the one thing passed in.

/* eslint-disable @typescript-eslint/no-explicit-any */
// See lib/checkin-core.ts for why the client type is loose here.
type Sb = SupabaseClient<any, any, any>;
type GymRow = Database['public']['Tables']['gyms']['Row'];

export type RenewResult = { ok: true; url: string; reference?: string } | { ok: false; error: string };

/**
 * Initialize a renewal checkout and hand back the authorization URL.
 *
 * Validates the plan belongs to the member's gym, prices it (plan + optional
 * trainer add-on) and initializes the transaction. Nothing here credits the
 * membership: the webhook — and the callback, as backup — record the payment
 * and extend the subscription once Paystack confirms charge.success.
 *
 * `withTrainer` is the member's opt-in to the plan's private-trainer add-on.
 * It's a request, not an instruction: the plan row decides whether the add-on
 * exists and what it costs, so a client that asks for a trainer on a plan that
 * doesn't offer one simply pays the plan price.
 */
export async function startRenewalCore(
  supabase: Sb,
  user: { id: string; email?: string | null },
  gym: GymRow,
  planId: string,
  withTrainer: boolean,
  callbackUrl: string | undefined,
): Promise<RenewResult> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  // Never open a checkout for a gym the platform has switched off. `subaccount`
  // below routes the split straight to the gym's own bank, so without this a
  // suspended tenant kept taking real money — and GymFlow would owe the member
  // either a membership it has disabled or a refund. Checked before the plan
  // lookup: the answer doesn't depend on which plan was asked for.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not accepting payments right now. Please contact the gym.' };
  }

  const { data: plan } = await supabase
    .from('membership_plans')
    .select('id, name, price, duration_days, duration_months, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gym.id).eq('is_active', true)
    .maybeSingle();
  if (!plan) return { ok: false, error: 'Plan not found.' };

  const trainerAddon = withTrainer && offersTrainer(plan);
  const amountKobo = planTotalKobo(plan, trainerAddon);

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
    callbackUrl,
    subaccount: (gym.paystack_subaccount_code ?? '').trim() || null,
    // The gym's commission arrangement travels with the charge: a fixed-mode
    // gym owes a flat fee per payment, and it has to be the same flat fee
    // whichever door the member paid through (web, WhatsApp, the app).
    commission: gymCommission(gym),
  };
  let res = await initTransaction(txParams);
  // If the stored subaccount code is stale/invalid at Paystack, retry without
  // it so the member can still pay (funds land in the platform account and the
  // gym owner is notified to reconnect payouts).
  if (!res.ok && txParams.subaccount && /invalid.*subaccount/i.test(res.error)) {
    res = await initTransaction({ ...txParams, subaccount: null });
  }
  return res.ok ? { ok: true, url: res.authorization_url, reference: res.reference } : { ok: false, error: res.error };
}
