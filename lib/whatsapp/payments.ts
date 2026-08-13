import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initTransaction } from '@/lib/paystack';
import { planTotalKobo, offersTrainer } from '@/lib/plan-addon';
import { isOfflineGym } from '@/lib/gym-status';
import { gymHomeUrl, type WhatsAppGym } from '@/lib/whatsapp/settings';
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

  const res = await initTransaction({
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
    // Paystack redirects here after payment. The gym's own subdomain, so a
    // member who does open it in a browser lands somewhere that recognises them.
    callbackUrl: `${gymHomeUrl(params.gym)}/dashboard/renew/callback`,
    subaccount: params.gym.paystack_subaccount_code,
  });

  if (!res.ok) return { ok: false, error: 'We couldn’t start the payment. Please try again shortly.' };

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
