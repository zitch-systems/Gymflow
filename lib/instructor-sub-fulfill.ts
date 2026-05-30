import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type DB = SupabaseClient<Database>;

export type InstructorSubAuthorization = {
  authorization_code?: string | null;
  last4?: string | null;
  exp_month?: string | null;
  exp_year?: string | null;
  card_type?: string | null;
  bank?: string | null;
  brand?: string | null;
  reusable?: boolean | null;
} | null | undefined;

export type InstructorSubFulfilResult =
  | { ok: true; already?: boolean; subscriptionId?: string | null; endDate?: string; amount?: number }
  | { ok: false; status: number; error: string };

/** Insert the payments mirror for this reference if it doesn't exist yet. */
async function ensurePaymentMirror(
  supabase: DB,
  args: { gymId: string; memberId: string; amount: number; reference: string; authorizationCode: string | null },
): Promise<void> {
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('paystack_reference', args.reference)
    .maybeSingle();
  if (existing) return;
  await supabase.from('payments').insert({
    gym_id: args.gymId,
    member_id: args.memberId,
    amount: args.amount,
    currency: 'NGN',
    payment_method: 'card',
    payment_status: 'successful',
    paystack_reference: args.reference,
    paystack_authorization_code: args.authorizationCode ?? null,
    payment_date: new Date().toISOString(),
  });
}

/**
 * Provision an instructor subscription for a successful Paystack charge.
 *
 * Price is looked up SERVER-SIDE from instructor_pricing (monthly) × months —
 * the client/webhook months value is bounded (1..24) by the caller, but the
 * per-month rate is never trusted from the payload.
 *
 * Idempotent on instructor_subscriptions.payment_reference, with the same
 * payments-mirror repair as the membership/pt-pack paths: if a prior attempt
 * created the subscription but failed before mirroring to payments, a retry
 * (browser verify OR webhook backstop) repairs it.
 *
 * The caller is responsible for verifying the Paystack charge (status, email
 * match, currency, amount) before calling this.
 */
export async function fulfilInstructorSubscription(
  supabase: DB,
  args: {
    gymId: string;
    instructorId: string;
    memberId: string;
    months: number;
    reference: string;
    authorization?: InstructorSubAuthorization;
    memberEmail?: string | null;
    // The verify route already looked up the monthly rate for its amount gate;
    // pass it to avoid a second query. The webhook omits it and the helper
    // looks it up itself.
    pricePerMonth?: number;
  },
): Promise<InstructorSubFulfilResult> {
  // Server-side price — never trust the client for money.
  let pricePerMonth = args.pricePerMonth;
  if (pricePerMonth == null) {
    const { data: pricing, error: pricingError } = await supabase
      .from('instructor_pricing')
      .select('price')
      .eq('gym_id', args.gymId)
      .eq('instructor_id', args.instructorId)
      .eq('is_active', true)
      .eq('billing_period', 'monthly')
      .maybeSingle();
    if (pricingError || !pricing) return { ok: false, status: 404, error: 'Instructor pricing not found' };
    pricePerMonth = Number(pricing.price);
  }
  const expectedTotal = pricePerMonth * args.months;

  // Idempotency on the subscription reference.
  const { data: existing } = await supabase
    .from('instructor_subscriptions')
    .select('id')
    .eq('payment_reference', args.reference)
    .maybeSingle();
  if (existing) {
    // Repair the payments mirror if a prior attempt left it missing.
    await ensurePaymentMirror(supabase, {
      gymId: args.gymId, memberId: args.memberId, amount: expectedTotal,
      reference: args.reference, authorizationCode: args.authorization?.authorization_code ?? null,
    });
    return { ok: true, already: true, subscriptionId: (existing as { id: string }).id };
  }

  const today = new Date().toISOString().split('T')[0];
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + args.months);
  const end_date = endDateObj.toISOString().split('T')[0];

  const { data: subscription, error: subError } = await supabase
    .from('instructor_subscriptions')
    .insert({
      gym_id: args.gymId,
      instructor_id: args.instructorId,
      member_id: args.memberId,
      status: 'active',
      start_date: today,
      end_date,
      amount_paid: expectedTotal,
      payment_reference: args.reference,
    })
    .select('id')
    .maybeSingle();
  if (subError) {
    // Concurrent caller (verify vs webhook) won the reference race.
    if (/duplicate key|unique/i.test(subError.message)) {
      await ensurePaymentMirror(supabase, {
        gymId: args.gymId, memberId: args.memberId, amount: expectedTotal,
        reference: args.reference, authorizationCode: args.authorization?.authorization_code ?? null,
      });
      return { ok: true, already: true };
    }
    return { ok: false, status: 500, error: `Subscription create failed: ${subError.message}` };
  }

  await ensurePaymentMirror(supabase, {
    gymId: args.gymId, memberId: args.memberId, amount: expectedTotal,
    reference: args.reference, authorizationCode: args.authorization?.authorization_code ?? null,
  });

  // Save the card so the instructor sub can auto-renew later.
  const auth = args.authorization;
  if (auth?.reusable && auth.authorization_code) {
    await supabase.from('saved_cards').upsert(
      {
        gym_id: args.gymId,
        member_id: args.memberId,
        authorization_code: auth.authorization_code,
        paystack_authorization_code: auth.authorization_code,
        card_type: auth.card_type ?? null,
        last4: auth.last4 ?? null,
        exp_month: auth.exp_month ?? null,
        exp_year: auth.exp_year ?? null,
        bank: auth.bank ?? null,
        brand: auth.brand ?? null,
        reusable: auth.reusable ?? true,
        email: args.memberEmail ?? null,
        is_default: true,
        is_active: true,
      },
      { onConflict: 'member_id,authorization_code' },
    );
  }

  return { ok: true, subscriptionId: (subscription as { id: string } | null)?.id ?? null, endDate: end_date, amount: expectedTotal };
}
