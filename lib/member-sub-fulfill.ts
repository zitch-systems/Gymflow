import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { extendDate } from '@/lib/plan-duration';
import { logAudit } from '@/lib/audit';
import type { Database } from '@/lib/database.types';

// Fulfillment for the MEMBER auto-billing flow (member → gym recurring
// charges via Paystack Subscriptions). Separate from lib/paystack-fulfill.ts
// (one-off member charges) and lib/platform-fulfill.ts (gym → GymFlow SaaS
// billing).
//
// Events handled:
//   * subscription.create        — cache subscription_code, email_token,
//                                   customer_code so we can disable it later
//   * charge.success (recurring) — record the payment, extend end_date by the
//                                   plan's duration
//   * invoice.payment_failed     — flip status to 'past_due' (member sees a
//                                   grace banner) + notification
//   * subscription.disable / not_renew — status 'expired' once Paystack gives up
//
// A member SUBSCRIPTION charge is distinguished from a platform SUBSCRIPTION
// charge by the metadata.kind = 'member_subscription' stamp we set at init.

type Json = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;
type MemberSubUpdate = Database['public']['Tables']['member_subscriptions']['Update'];

export type Result = { ok: boolean; handled: boolean; error?: string; permanent?: boolean };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

// Is this event a MEMBER subscription event (vs platform)? Two signals:
//   • metadata.kind === 'member_subscription' (present on charge.success)
//   • the subscription_code / customer_code matches a member_subscriptions row
export async function isMemberSubEvent(event: Json): Promise<boolean> {
  const name = str(event.event) ?? '';
  const data = (event.data as Json) ?? {};
  const meta = (data.metadata as Json) ?? {};

  // charge.success carries our metadata directly.
  if (name === 'charge.success' && str(meta.kind) === 'member_subscription') return true;

  // subscription.* / invoice.* events don't echo metadata. We match by
  // subscription_code or customer_code against member_subscriptions.
  if (!name.startsWith('subscription.') && !name.startsWith('invoice.') && name !== 'charge.success') return false;

  const subCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const custCode = str((data.customer as Json)?.customer_code);
  if (!subCode && !custCode) return false;

  const admin = createAdminClient();
  if (subCode) {
    const { data: hit } = await admin.from('member_subscriptions').select('id').eq('paystack_subscription_code', subCode).limit(1);
    if (hit && hit.length) return true;
  }
  if (custCode) {
    const { data: hit } = await admin.from('member_subscriptions').select('id').eq('paystack_customer_code', custCode).limit(1);
    if (hit && hit.length) return true;
  }
  return false;
}

async function findSub(admin: Admin, subCode: string | null, custCode: string | null, metaMemberId: string | null, metaGymId: string | null) {
  if (subCode) {
    const { data } = await admin.from('member_subscriptions').select('*').eq('paystack_subscription_code', subCode).limit(1).maybeSingle();
    if (data) return data;
  }
  if (custCode) {
    const { data } = await admin.from('member_subscriptions').select('*').eq('paystack_customer_code', custCode).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  if (metaMemberId && metaGymId) {
    // First-charge case: the subscription code hasn't been stored yet. Match
    // the most recent sub for this member in this gym.
    const { data } = await admin
      .from('member_subscriptions').select('*')
      .eq('member_id', metaMemberId).eq('gym_id', metaGymId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

// subscription.create: cache the codes so future recurring events resolve back
// to this member and cancel calls have what Paystack needs.
async function onSubscriptionCreate(admin: Admin, data: Json): Promise<Result> {
  const subCode = str(data.subscription_code);
  const emailToken = str(data.email_token);
  const customer = (data.customer as Json) ?? {};
  const custCode = str(customer.customer_code);

  const sub = await findSub(admin, subCode, custCode, null, null);
  if (!sub) return { ok: true, handled: true }; // The first charge.success will link them; ack.

  const patch: MemberSubUpdate = { updated_at: new Date().toISOString(), auto_debit_enabled: true };
  if (subCode) patch.paystack_subscription_code = subCode;
  if (emailToken) patch.paystack_email_token = emailToken;
  if (custCode) patch.paystack_customer_code = custCode;

  const { error } = await admin.from('member_subscriptions').update(patch).eq('id', sub.id);
  if (error) return { ok: false, handled: true, error: error.message };
  return { ok: true, handled: true };
}

// charge.success (recurring): record the payment and extend end_date. Recurring
// charges don't carry our metadata (Paystack drops it after the first cycle),
// so we resolve the sub by subscription_code / customer_code.
async function onRecurringCharge(admin: Admin, data: Json): Promise<Result> {
  const reference = str(data.reference);
  if (!reference) return { ok: false, handled: true, error: 'missing reference', permanent: true };

  const meta = (data.metadata as Json) ?? {};
  const customer = (data.customer as Json) ?? {};
  const subCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const custCode = str(customer.customer_code);

  const sub = await findSub(admin, subCode, custCode, str(meta.member_id), str(meta.gym_id));
  if (!sub) return { ok: false, handled: true, error: 'could not resolve member subscription', permanent: true };

  // Idempotency: payments.paystack_reference is UNIQUE. Fast-path pre-check
  // then the 23505 catch is the real guard.
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', reference).maybeSingle();
  if (existing) return { ok: true, handled: true };

  const amountKobo = Number(data.amount ?? 0);

  // Load the plan's duration to extend end_date correctly. We prefer the sub's
  // own plan_id (survives if the membership_plans row is later archived) and
  // fall back to metadata.plan_id.
  const planId = sub.plan_id ?? str(meta.plan_id);
  let extendBy = { duration_days: null as number | null, duration_months: 1 as number | null };
  if (planId) {
    const { data: plan } = await admin.from('membership_plans')
      .select('duration_days, duration_months').eq('id', planId).eq('gym_id', sub.gym_id).maybeSingle();
    if (plan) extendBy = { duration_days: plan.duration_days ?? null, duration_months: plan.duration_months ?? 1 };
  }

  const { error: payErr } = await admin.from('payments').insert({
    member_id: sub.member_id, gym_id: sub.gym_id, plan_id: planId ?? null,
    amount: amountKobo / 100, currency: 'NGN',
    status: 'success', payment_status: 'successful',
    payment_method: 'auto_debit', paystack_reference: reference,
    payment_date: new Date().toISOString(),
  });
  if (payErr) {
    if (payErr.code === '23505') return { ok: true, handled: true }; // concurrent fulfiller won
    return { ok: false, handled: true, error: payErr.message };
  }

  // Extend from the later of {current end_date, today}. Recurring charges
  // should push forward; they should never shorten.
  const base = sub.end_date && new Date(sub.end_date) > new Date() ? new Date(sub.end_date) : new Date();
  const newEnd = extendDate(base, extendBy).toISOString().slice(0, 10);

  const { error: subErr } = await admin.from('member_subscriptions').update({
    end_date: newEnd,
    status: 'active', // recovers from past_due once payment lands
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);
  if (subErr) {
    // Compensate — remove the payment row so a retry can re-attempt everything.
    await admin.from('payments').delete().eq('paystack_reference', reference);
    return { ok: false, handled: true, error: `sub extend failed: ${subErr.message}` };
  }

  // Best-effort receipt notification.
  await admin.from('notifications').insert({
    gym_id: sub.gym_id, user_id: sub.member_id, type: 'payment', channel: 'in_app',
    title: 'Membership renewed', body: `₦${(amountKobo / 100).toLocaleString('en-NG')} auto-debited — access extended to ${newEnd}.`,
  });

  return { ok: true, handled: true };
}

// invoice.payment_failed: enter grace state. The member sees a dashboard banner
// and can retry manually; Paystack continues its own retry schedule.
async function onPaymentFailed(admin: Admin, data: Json): Promise<Result> {
  const subCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const customer = (data.customer as Json) ?? {};
  const sub = await findSub(admin, subCode, str(customer.customer_code), null, null);
  if (!sub) return { ok: true, handled: true };

  await admin.from('member_subscriptions').update({
    status: 'past_due', updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  await admin.from('notifications').insert({
    gym_id: sub.gym_id, user_id: sub.member_id, type: 'warning', channel: 'in_app',
    title: 'Payment failed', body: 'Your auto-renew charge didn\'t go through. Update your card in the app to keep access.',
  });

  void logAudit({
    action: 'member_auto_renew_payment_failed',
    table: 'member_subscriptions',
    gymId: sub.gym_id, recordId: sub.id,
    values: { member_id: sub.member_id },
  });

  return { ok: true, handled: true };
}

// subscription.disable / subscription.not_renew: Paystack has stopped billing.
// Flip to expired unless the current period is still in the future (member paid
// through it — access continues to end_date).
async function onSubscriptionEnd(admin: Admin, data: Json): Promise<Result> {
  const subCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const customer = (data.customer as Json) ?? {};
  const sub = await findSub(admin, subCode, str(customer.customer_code), null, null);
  if (!sub) return { ok: true, handled: true };

  const stillPaid = sub.end_date && new Date(sub.end_date) >= new Date();
  const newStatus = stillPaid ? 'active' : 'expired';

  await admin.from('member_subscriptions').update({
    status: newStatus, auto_debit_enabled: false, updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  return { ok: true, handled: true };
}

// Top-level dispatcher the webhook calls once it knows the event is a member sub.
export async function handleMemberSubEvent(event: Json): Promise<Result> {
  let admin: Admin;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, handled: true, error: (e as Error).message }; }

  const name = str(event.event) ?? '';
  const data = (event.data as Json) ?? {};

  switch (name) {
    case 'subscription.create': return onSubscriptionCreate(admin, data);
    case 'charge.success': return onRecurringCharge(admin, data);
    case 'invoice.payment_failed': return onPaymentFailed(admin, data);
    case 'subscription.disable':
    case 'subscription.not_renew': return onSubscriptionEnd(admin, data);
    default: return { ok: true, handled: true }; // invoice.create/update — ack, no-op
  }
}
