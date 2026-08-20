import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initTransaction } from '@/lib/paystack';
import { planTotalKobo, offersTrainer } from '@/lib/plan-addon';
import { isOfflineGym } from '@/lib/gym-status';
import type { WhatsAppGym } from '@/lib/whatsapp/settings';
import { captureServerEvent } from '@/lib/server-error';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// Paying for a membership from inside WhatsApp.
//
// The member picks a package from a list message and gets back a Paystack
// checkout link. Everything after that is the EXISTING payment machinery: the
// charge.success webhook (lib/paystack-fulfill.ts) records the payment and
// extends the subscription, exactly as it does for a renewal started on the
// web. This module adds no second fulfilment path — a parallel one would be the
// obvious way to end up with a member who paid and was never credited, or
// credited twice.
//
// What it does add is `whatsapp_payment_intents`: a row tying the Paystack
// reference back to the WhatsApp thread, so the confirmation lands in the
// conversation the member started, and so an abandoned checkout is visible to
// the gym instead of vanishing.

export type CheckoutOutcome =
  | { ok: true; url: string; reference: string; planName: string; amountKobo: number }
  | { ok: false; error: string };

/**
 * Start a checkout for a chosen plan.
 *
 * The plan is re-read from the database and re-priced here; the identifier that
 * arrived from WhatsApp is treated as a selection, never as a price. `withTrainer`
 * is likewise a request — the plan row decides whether the add-on exists at all.
 */
export async function startWhatsAppCheckout(
  admin: Admin,
  params: {
    gym: WhatsAppGym;
    contactId: string;
    memberId: string;
    memberEmail: string;
    planId: string;
    withTrainer?: boolean;
  },
): Promise<CheckoutOutcome> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments aren’t set up for this gym yet. Please speak to the front desk.' };
  }
  // A gym the platform has switched off must not take money: the split settles
  // straight to its own bank, so a charge here would leave GymFlow owing either
  // a membership it has disabled or a refund.
  if (isOfflineGym(params.gym)) {
    return { ok: false, error: 'This gym isn’t accepting payments right now. Please contact the gym.' };
  }

  // The member must be actively linked to THIS gym before a link is issued,
  // because fulfilment refuses without that link: lib/paystack-fulfill.ts reads
  // exactly the query below and returns 'member is not active in gym' as a
  // PERMANENT failure — the webhook acks, nothing is retried, no payments row
  // is written and no day is added. The money still settles into the gym's
  // bank, so a checkout started here without the link is a charge that can
  // never be credited.
  //
  // WhatsApp is the only surface that can reach that state. The web renewal
  // resolves the link in requireMember() before it initialises anything, but
  // here the active gym moves on a typed member code or a scanned door QR with
  // no re-auth (resolveGym / handleQrCheckin in router.ts), so a verified
  // member of gym A can arrive at gym B's package list — and a suspended member
  // can reach their own gym's.
  //
  // The predicate is fulfillCharge's, verbatim (user_id + is_active), not
  // check-in's looser member_id-or-user_id one: a pre-check that admits
  // anything fulfilment will refuse is worth nothing.
  //
  // The query error is kept separate from the empty result, exactly as
  // fulfillCharge keeps them: collapsing the two would make a transient
  // PostgREST failure read as "not a member" and tell a paid-up member they
  // aren't one. The two failures want opposite handling — a DB error is
  // "try again in a moment", a genuinely missing link is the sentence below.
  const { data: link, error: linkErr } = await admin
    .from('gym_member_links').select('id')
    .eq('user_id', params.memberId).eq('gym_id', params.gym.id).eq('is_active', true)
    .limit(1).maybeSingle();
  if (linkErr) {
    console.error('[whatsapp/payments] member link lookup failed:', linkErr.message);
    return { ok: false, error: 'Sorry — I couldn’t check your membership just now. Please try again in a moment.' };
  }
  if (!link) {
    // Only on the refusal path: is there a link at all, so the reply can tell
    // them which of the two things to actually do.
    const { data: inactive } = await admin
      .from('gym_member_links').select('id')
      .eq('user_id', params.memberId).eq('gym_id', params.gym.id)
      .limit(1).maybeSingle();
    return inactive
      ? {
          ok: false,
          error: `Your ${params.gym.name} membership is suspended, so paying now wouldn’t reactivate it. Please see the front desk — once they lift it you can renew right here.`,
        }
      : {
          ok: false,
          error: `You’re not a member at ${params.gym.name} yet, so I can’t take a payment for it. Ask the front desk to sign you up first.\n\nAt a different gym? Reply with that gym’s code and I’ll switch over.`,
        };
  }

  const { data } = await admin
    .from('membership_plans')
    .select('id, name, price, duration_days, duration_months, trainer_addon_enabled, trainer_addon_price')
    .eq('id', params.planId).eq('gym_id', params.gym.id).eq('is_active', true)
    .maybeSingle();

  const plan = data as {
    id: string; name: string; price: number;
    duration_days: number | null; duration_months: number | null;
    trainer_addon_enabled: boolean | null; trainer_addon_price: number | null;
  } | null;
  if (!plan) return { ok: false, error: 'That package isn’t available. Reply RENEW to see the current list.' };

  const trainerAddon = Boolean(params.withTrainer) && offersTrainer(plan);
  const amountKobo = planTotalKobo(plan, trainerAddon);

  const txParams = {
    email: params.memberEmail,
    amountKobo,
    metadata: {
      member_id: params.memberId,
      gym_id: params.gym.id,
      plan_id: plan.id,
      duration_days: plan.duration_days,
      duration_months: plan.duration_months,
      trainer_addon: trainerAddon,
      // Snapshot of what this checkout was initialised to settle, so a later
      // price edit neither strands a valid charge nor permits an underpaid one.
      expected_amount_kobo: amountKobo,
      kind: 'membership_renewal',
      // Where the confirmation should be delivered.
      source: 'whatsapp',
      whatsapp_contact_id: params.contactId,
    },
    // A member paying from WhatsApp has no web session on this device — the
    // ordinary /dashboard/renew/callback requires one and would bounce them to
    // /login instead of back to the chat. This callback is session-free and
    // sends them back to WhatsApp once the charge is recorded.
    callbackUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng'}/pay/whatsapp/callback`,
    subaccount: (params.gym.paystack_subaccount_code ?? '').trim() || null,
  };
  let res = await initTransaction(txParams);
  // If the stored subaccount code is stale/invalid at Paystack, retry without
  // it so the member can still pay (funds land in the platform account and the
  // gym owner is notified to reconnect payouts) — same recovery the web
  // renewal flow already does in lib/actions/renew.ts.
  if (!res.ok && txParams.subaccount && /invalid.*subaccount/i.test(res.error)) {
    res = await initTransaction({ ...txParams, subaccount: null });
  }

  if (!res.ok) {
    // Paystack's own message is the only thing that says WHY, and every cause
    // looks identical from the member's side: a key from the wrong environment,
    // a subaccount that belongs to a different Paystack account, an amount
    // below the minimum. Discarding it — as this did — makes the one failure a
    // member can actually hit the one failure nobody can diagnose. They still
    // see a generic line, because Paystack's internals are not theirs to read.
    console.error('[whatsapp/payments] paystack init failed:', res.error);
    void captureServerEvent('whatsapp checkout init failed', {
      reason: res.error,
      gymId: params.gym.id,
      planId: plan.id,
      amountKobo,
      // Whether a subaccount was sent at all is half the answer on its own.
      subaccount: params.gym.paystack_subaccount_code ?? null,
    });
    return { ok: false, error: 'We couldn’t start the payment. Please try again shortly.' };
  }

  // Best-effort: the checkout is already live, so a bookkeeping failure here
  // must not deny the member the link they are waiting for. Losing the row
  // costs a confirmation message, not a payment.
  const { error } = await admin.from('whatsapp_payment_intents').insert({
    contact_id: params.contactId,
    gym_id: params.gym.id,
    member_id: params.memberId,
    plan_id: plan.id,
    reference: res.reference,
    amount_kobo: amountKobo,
    with_trainer: trainerAddon,
    authorization_url: res.authorization_url,
  });
  if (error) console.error('[whatsapp/payments] intent insert failed:', error.message);

  return { ok: true, url: res.authorization_url, reference: res.reference, planName: plan.name, amountKobo };
}

export type PaymentIntent = {
  id: string;
  contact_id: string;
  gym_id: string;
  member_id: string;
  reference: string;
  amount_kobo: number;
  status: string;
};

/** Look an intent up by Paystack reference, so a webhook can find its thread. */
export async function intentByReference(admin: Admin, reference: string): Promise<PaymentIntent | null> {
  const { data } = await admin
    .from('whatsapp_payment_intents')
    .select('id, contact_id, gym_id, member_id, reference, amount_kobo, status')
    .eq('reference', reference)
    .maybeSingle();
  return (data as PaymentIntent | null) ?? null;
}

export async function markIntent(
  admin: Admin,
  reference: string,
  status: 'paid' | 'failed' | 'abandoned',
): Promise<void> {
  await admin
    .from('whatsapp_payment_intents')
    .update({ status, completed_at: new Date().toISOString() })
    .eq('reference', reference)
    // Only ever move a pending intent. A webhook redelivery must not rewrite a
    // settled one, and a late 'abandoned' sweep must not overwrite 'paid'.
    .eq('status', 'pending');
}

/**
 * Sweep stale pending intents. Called from the daily cron so the gym's WhatsApp
 * tab shows "abandoned" rather than an ever-growing list of things that look
 * like they are still in progress.
 */
export async function expireStaleIntents(admin: Admin, olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  const { data } = await admin
    .from('whatsapp_payment_intents')
    .update({ status: 'abandoned', completed_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');
  return ((data as { id: string }[] | null) ?? []).length;
}
