import 'server-only';
import type { Database } from '@/lib/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { isOfflineGym } from '@/lib/gym-status';
import { gymCanUse, memberLockedMessage } from '@/lib/entitlements';
import { initSubscription, createPlan, planIntervalFor } from '@/lib/paystack';
import { LIVE_SUB_STATUSES, hasLiveMandate } from '@/lib/member-sub-core';
import { offersTrainer, planTotalKobo } from '@/lib/plan-addon';
import { reserveAutoRenewalCheckout, finishAutoRenewalInitialization } from '@/lib/member-checkout';
import { captureServerEvent } from '@/lib/server-error';

export type StartResult = { ok: true; url: string; reference?: string } | { ok: false; error: string };

// Get or lazy-create the Paystack Plan code for a membership_plans row. Cached
// on the row so subsequent opt-ins reuse it. Uses the admin client so the
// UPDATE isn't blocked by RLS (membership_plans staff-write policy exists but
// we want member auto-billing to work even when the member is the one
// triggering creation).
// Returns the amount alongside the code: initSubscription has to send one
// (Paystack requires it even with a plan code), and the membership_plans row
// read here is where the price already is.
//
// A Paystack Plan fixes ONE recurring amount, so plan-with-trainer needs its
// own Plan object and its own cached code (paystack_plan_code_trainer).
// Reusing the base code for a member who took the add-on would charge them the
// plan price alone on every cycle after the first — the gym would hand out
// trainer time it stopped being paid for, silently.
async function ensurePlanCode(
  planId: string,
  gymId: string,
  withTrainer: boolean,
): Promise<{ ok: true; code: string; amountKobo: number; trainerAddon: boolean; durationDays: number | null; durationMonths: number | null } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from('membership_plans')
    .select('id, gym_id, name, price, duration_days, duration_months, paystack_plan_code, paystack_plan_code_trainer, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gymId).eq('is_active', true)
    .maybeSingle();
  if (error) return { ok: false, error: 'The plan could not be loaded. Please try again.' };
  if (!plan) return { ok: false, error: 'Plan not found.' };

  // The plan row, not the caller, decides whether the add-on applies.
  const trainerAddon = withTrainer && offersTrainer(plan);
  const amountKobo = planTotalKobo(plan, trainerAddon);
  const cached = trainerAddon ? plan.paystack_plan_code_trainer : plan.paystack_plan_code;
  const period = { durationDays: plan.duration_days, durationMonths: plan.duration_months };
  if (cached) return { ok: true, code: cached, amountKobo, trainerAddon, ...period };

  const interval = planIntervalFor(plan.duration_days ?? null, plan.duration_months ?? null);
  if (!interval) return { ok: false, error: `Plan "${plan.name}" duration doesn't map to a Paystack billing interval.` };

  const res = await createPlan({
    name: trainerAddon ? `${plan.name} + private trainer (auto-renew)` : `${plan.name} (auto-renew)`,
    amountKobo,
    interval,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Cache. If two callers race, second write is a no-op (both share the same
  // eventual code) — Paystack will just have two Plan objects with the same
  // config, harmless.
  await admin.from('membership_plans')
    .update(trainerAddon ? { paystack_plan_code_trainer: res.planCode } : { paystack_plan_code: res.planCode })
    .eq('id', plan.id);
  return { ok: true, code: res.planCode, amountKobo, trainerAddon, ...period };
}

// Start an auto-renewing subscription for the signed-in member. Same shape as
// startRenewal in renew.ts (returns the Paystack authorization URL to redirect
// to), but wires Paystack Subscriptions so future charges recur automatically.
// The webhook (lib/member-sub-fulfill.ts) records renewals and tracks state.
export async function startAutoRenewalCore(
  user: { id: string; email?: string | null },
  gym: Database['public']['Tables']['gyms']['Row'],
  planId: string, withTrainer: boolean, callbackUrl: string | undefined,
): Promise<StartResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) return { ok: false, error: 'Choose a valid plan.' };
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  // See the same guard in renew.ts. This one matters more, not less: a
  // subscription keeps charging on a schedule, so one that slips through
  // outlives the checkout by months.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not accepting payments right now. Please contact the gym.' };
  }
  // And the same reasoning for the plan gate as in renew.ts, doubled for the
  // same reason as the line above: a mandate this action opens keeps charging
  // on a schedule long after the surface that opened it was walled off.
  if (!gymCanUse(gym, 'member_app')) {
    return { ok: false, error: memberLockedMessage(gym.name, 'the member app') };
  }

  // One mandate per member. A member who already has auto-renew on — on this
  // plan or another one — would otherwise get a SECOND live Paystack
  // Subscription against the same card, and the fulfiller refuses that
  // mandate's charges permanently (`subscription code conflicts with active
  // mandate`, lib/member-sub-fulfill.ts). Every cycle after that debits the
  // card, records no payment, extends nothing and sends no receipt; the
  // webhook still acks 200, so Paystack keeps charging. Refusing here is the
  // only place that stops it, because by the time the charge lands the money
  // has already left. Service role: the member CAN read their own rows, but a
  // guard this consequential must not be one RLS edit away from silently
  // passing.
  const admin = createAdminClient();
  const { data: liveSubs, error: liveErr } = await admin
    .from('member_subscriptions')
    .select('auto_debit_enabled')
    .eq('member_id', user.id).eq('gym_id', gym.id)
    .in('status', [...LIVE_SUB_STATUSES]);
  // The member gets a sentence, never PostgREST's. This guard is the only thing
  // standing between them and a second live mandate, so it must refuse when it
  // cannot see — but the reason belongs in the server log, not on their screen.
  if (liveErr) {
    console.error(`[member-billing] live subscription lookup failed for ${user.id}: ${liveErr.message}`);
    return { ok: false, error: 'We couldn’t check your current auto-renew settings just now. Please try again in a moment.' };
  }
  if (hasLiveMandate(liveSubs)) {
    return { ok: false, error: 'Auto-renew is already on for your membership. Turn it off first, then switch it on for the plan you want.' };
  }

  const codeResult = await ensurePlanCode(planId, gym.id, withTrainer);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };
  const checkout = await reserveAutoRenewalCheckout({
    gymId: gym.id, memberId: user.id, planId, amountKobo: codeResult.amountKobo,
    durationDays: codeResult.durationDays, durationMonths: codeResult.durationMonths,
    trainerAddon: codeResult.trainerAddon,
    providerPlanCode: codeResult.code,
  }, admin);
  if (!checkout.ok) return checkout;
  if (!checkout.created) {
    if (checkout.state === 'ready' && checkout.url) return { ok: true, url: checkout.url, reference: checkout.reference };
    return { ok: false, error: 'Your auto-renew checkout is being confirmed. Please retry shortly; contact the gym if it stays pending. Do not start a second payment.' };
  }

  const res = await initSubscription({
    reference: checkout.reference,
    email: user.email ?? '',
    planCode: codeResult.code,
    amountKobo: codeResult.amountKobo,
    metadata: {
      kind: 'member_subscription', gym_id: gym.id, member_id: user.id, plan_id: planId,
      // Recorded on the subscription by the fulfiller so the gym can see who is
      // owed trainer time. Recurring cycles drop metadata, but the mandate is
      // bound to the with-trainer Paystack Plan, so the flag stays true for the
      // life of the subscription.
      trainer_addon: codeResult.trainerAddon,
    },
    callbackUrl,
  });
  const saved = await finishAutoRenewalInitialization(admin, res.ok
    ? { reference: checkout.reference, url: res.authorization_url }
    : { reference: checkout.reference, definiteFailure: res.definiteFailure, error: 'Provider initialization not confirmed' });
  if (!res.ok || !saved) {
    await captureServerEvent('member auto-renew initialization not confirmed', { reference: checkout.reference, source: 'auto-renew' });
    return { ok: false, error: res.ok
      ? 'Your checkout could not be confirmed. Contact the gym before starting another payment.'
      : 'Your checkout could not be confirmed. Retry shortly; if it stays pending, contact the gym before starting another payment.' };
  }
  return { ok: true, url: res.authorization_url, reference: checkout.reference };
}

