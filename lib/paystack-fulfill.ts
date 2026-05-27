import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { sendReceipt } from '@/lib/email';
import { waReceipt } from '@/lib/whatsapp';

type DB = SupabaseClient<Database>;

export type FulfilAuthorization = {
  authorization_code?: string | null;
  last4?: string | null;
  exp_month?: string | null;
  exp_year?: string | null;
  card_type?: string | null;
  bank?: string | null;
  brand?: string | null;
  reusable?: boolean | null;
} | null | undefined;

export type FulfilTxn = {
  reference: string;
  amountKobo: number;
  currency?: string | null;
  customerEmail: string;
  authorization?: FulfilAuthorization;
};

export type FulfilResult =
  | { ok: true; already?: boolean; membershipId?: string | null }
  | { ok: false; status: number; error: string };

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split('T')[0];
}

/**
 * Provision a membership for a successful Paystack charge. The plan is the
 * single source of truth for gym, price, and duration — the client/webhook
 * payload is never trusted for money. Idempotent on the payment reference, so
 * it is safe to call from BOTH the browser /verify path and the server-to-server
 * webhook: whichever arrives first creates the membership, the other no-ops.
 */
export async function fulfilMembershipPurchase(
  supabase: DB,
  memberId: string,
  planId: string,
  txn: FulfilTxn,
  opts: { paymentMethod?: string; notify?: boolean } = {},
): Promise<FulfilResult> {
  const paymentMethod = opts.paymentMethod ?? 'card';

  // Idempotency: a reference is processed at most once. The UNIQUE constraint on
  // payments.paystack_reference is the hard backstop for the rare race window.
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('paystack_reference', txn.reference)
    .maybeSingle();
  if (existingPayment) return { ok: true, already: true };

  const { data: plan } = await supabase
    .from('membership_plans')
    .select('id, gym_id, name, price, duration_months, is_active')
    .eq('id', planId)
    .maybeSingle();
  if (!plan || plan.is_active === false) {
    return { ok: false, status: 400, error: 'Plan not found or inactive' };
  }
  const gym_id = plan.gym_id as string;
  const price = Number(plan.price);
  const durationMonths = Number(plan.duration_months ?? 1);

  if ((txn.currency ?? 'NGN') !== 'NGN') {
    return { ok: false, status: 400, error: 'Unsupported payment currency' };
  }
  if (Number(txn.amountKobo) < Math.round(price * 100)) {
    return { ok: false, status: 400, error: 'Amount paid is less than the plan price' };
  }

  const today = new Date().toISOString().split('T')[0];

  // Pay-ahead: stack on top of the member's current active period.
  const { data: current } = await supabase
    .from('memberships')
    .select('end_date')
    .eq('member_id', memberId)
    .eq('gym_id', gym_id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = current?.end_date && current.end_date > today ? current.end_date : today;
  const end_date = addMonths(base, durationMonths);

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .insert({
      member_id: memberId,
      gym_id,
      plan_id: planId,
      status: 'active',
      start_date: today,
      end_date,
      auto_debit_enabled: false,
    })
    .select('id')
    .maybeSingle();
  if (membershipError) {
    return { ok: false, status: 500, error: `Membership create failed: ${membershipError.message}` };
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    gym_id,
    member_id: memberId,
    plan_id: planId,
    amount: price,
    currency: 'NGN',
    payment_method: paymentMethod,
    payment_status: 'successful',
    paystack_reference: txn.reference,
    paystack_authorization_code: txn.authorization?.authorization_code ?? null,
    payment_date: new Date().toISOString(),
  });
  if (paymentError) {
    // Most likely a concurrent caller won the reference race (UNIQUE violation).
    // The membership row we just created is the duplicate — roll it back so we
    // don't leave a phantom membership behind, then report idempotent success.
    if (membership?.id) {
      await supabase.from('memberships').delete().eq('id', membership.id);
    }
    if (/duplicate key|unique/i.test(paymentError.message)) {
      return { ok: true, already: true };
    }
    return { ok: false, status: 500, error: `Payment record failed: ${paymentError.message}` };
  }

  const auth = txn.authorization;
  if (auth?.reusable && auth.authorization_code) {
    await supabase.from('saved_cards').upsert(
      {
        gym_id,
        member_id: memberId,
        authorization_code: auth.authorization_code,
        paystack_authorization_code: auth.authorization_code,
        card_type: auth.card_type ?? null,
        last4: auth.last4 ?? null,
        exp_month: auth.exp_month ?? null,
        exp_year: auth.exp_year ?? null,
        bank: auth.bank ?? null,
        brand: auth.brand ?? null,
        reusable: auth.reusable ?? true,
        email: txn.customerEmail,
        is_default: true,
        is_active: true,
      },
      { onConflict: 'member_id,authorization_code' },
    );
  }

  if (opts.notify) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, first_name, phone')
        .eq('id', memberId)
        .maybeSingle();
      const name = profile?.full_name ?? profile?.first_name ?? 'Member';
      await Promise.allSettled([
        sendReceipt(txn.customerEmail, { name, amount: price, plan: plan.name ?? 'Membership', endDate: end_date }),
        profile?.phone ? waReceipt(profile.phone, { name, amount: price, endDate: end_date }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF fulfil] receipt notification failed:', (e as Error).message);
    }
  }

  return { ok: true, membershipId: membership?.id ?? null };
}
