import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPlanTier, PLATFORM_PLANS, type PlanTier } from '@/lib/platform-plans';
import { fmtDate } from '@/lib/format';
import type { EmailContent } from '@/lib/email';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { getGymOwnerEmails } from '@/lib/email/recipients';
import { subscriptionCancelled, subscriptionPastDue, subscriptionReceipt } from '@/lib/email/templates/platform';
import type { Database } from '@/lib/database.types';
import { settledAmountMatches } from '@/lib/paystack-event-state';

type GymUpdate = Database['public']['Tables']['gyms']['Update'];

// Fulfillment for the PLATFORM (gym → GymFlow) billing flow, driven by Paystack
// Subscriptions. Separate from lib/paystack-fulfill.ts, which handles the
// member → gym flow. Service-role: platform_payments + gyms are RLS-locked and
// the webhook has no user session.

type Json = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

export type PlatformResult = { ok: boolean; handled: boolean; error?: string; permanent?: boolean };

const PLATFORM_EVENTS = new Set([
  'charge.success', 'subscription.create', 'subscription.disable',
  'subscription.not_renew', 'invoice.payment_failed',
]);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

// The set of Paystack plan codes we recognise as platform plans (from env).
function platformPlanCodes(): Map<string, PlanTier> {
  const m = new Map<string, PlanTier>();
  for (const p of Object.values(PLATFORM_PLANS)) {
    const code = process.env[p.planCodeEnv];
    if (code) m.set(code, p.tier);
  }
  return m;
}

// Does this event belong to the platform flow? True for any subscription/invoice
// lifecycle event, and for charge.success on a SUBSCRIPTION charge (vs a member
// one-off membership charge).
export function isPlatformEvent(event: Json): boolean {
  const name = str(event.event) ?? '';
  if (name.startsWith('subscription.') || name.startsWith('invoice.')) return PLATFORM_EVENTS.has(name) || name === 'invoice.create' || name === 'invoice.update';
  if (name !== 'charge.success') return false;
  const data = (event.data as Json) ?? {};
  const meta = (data.metadata as Json) ?? {};
  if (str(meta.kind) === 'platform_subscription') return true;
  // A Paystack `plan` object only appears on SUBSCRIPTION charges; member
  // (one-off) charges never carry one. Keying on its presence — not on the
  // plan code matching an env var — means recurring charges are still classified
  // correctly even if PAYSTACK_PLAN_* drifts or our metadata isn't echoed back.
  // (resolveGymId then no-ops harmlessly for any unrelated account-level plan.)
  return str((data.plan as Json)?.plan_code) !== null;
}

async function gymIdByColumn(admin: Admin, column: 'paystack_subscription_code' | 'paystack_customer_code', value: string): Promise<string | null> {
  // subscription_code should be unique. customer_code is explicitly NOT: a
  // multi-gym owner may reuse one Paystack customer. Never choose the first row
  // in an ambiguous set and apply money/state to the wrong tenant.
  const { data } = await admin.from('gyms').select('id').eq(column, value).limit(2);
  return data?.length === 1 ? data[0].id : null;
}

// Resolve the gym a Paystack event refers to: prefer the gym_id we stamped into
// the init metadata, then the UNIQUE subscription code, and only as a last resort
// the (possibly shared) customer code. Recurring charges and subscription.* events
// don't carry our metadata, so the codes are the fallback.
async function resolveGymId(admin: Admin, hints: { metaGymId?: string | null; subscriptionCode?: string | null; customerCode?: string | null }): Promise<string | null> {
  if (hints.metaGymId) return hints.metaGymId;
  if (hints.subscriptionCode) {
    const id = await gymIdByColumn(admin, 'paystack_subscription_code', hints.subscriptionCode);
    if (id) return id;
  }
  if (hints.customerCode) {
    const id = await gymIdByColumn(admin, 'paystack_customer_code', hints.customerCode);
    if (id) return id;
  }
  return null;
}

function tierFromCharge(meta: Json, plan: Json): PlanTier | null {
  const metaPlan = str(meta.plan);
  if (metaPlan && isPlanTier(metaPlan)) return metaPlan;
  const code = str(plan.plan_code);
  if (code) {
    const found = platformPlanCodes().get(code);
    if (found) return found;
  }
  return null;
}

function addMonths(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

// ── Owner mail ───────────────────────────────────────────────────────────────

type BillingGym = {
  name: string | null;
  subscription_plan: string | null;
  subscription_current_period_end: string | null;
};

/** 'growth' → 'Growth'. The column holds the plan code; an owner reading a
 *  receipt should see the name that's on the pricing page. */
function planLabel(plan: string | null | undefined): string {
  const p = (plan ?? '').trim();
  return isPlanTier(p) ? PLATFORM_PLANS[p].name : 'GymFlow';
}

/** Price to quote when the event carries no amount. An unrecognised plan falls
 *  back to the entry tier rather than zero: an owner who reads "₦0 was
 *  declined" concludes the email is broken and ignores the deadline it
 *  carries. */
function planKobo(plan: string | null | undefined): number {
  const p = (plan ?? '').trim();
  return isPlanTier(p) ? PLATFORM_PLANS[p].amountKobo : PLATFORM_PLANS.starter.amountKobo;
}

/** The paid-through date is what makes both the dunning and the cancellation
 *  mail actionable; a gym with none recorded gets the honest vague form rather
 *  than an em dash. */
function accessUntil(iso: string | null): string {
  return iso ? fmtDate(iso) : 'the end of your paid period';
}

/**
 * Mail a gym's owners about its GymFlow subscription.
 *
 * All three billing emails go to the same audience off the same two reads, so
 * they live here once. Skipped wholesale when email is off — a webhook must not
 * pay for two round-trips to discover it has nothing to send — and never
 * allowed to fail fulfilment: the money has already moved, and a non-2xx makes
 * Paystack redeliver an event we have already applied.
 */
async function mailOwners(
  admin: Admin,
  gymId: string,
  build: (gym: BillingGym) => EmailContent,
  template: string,
  idempotencyKey?: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const [{ data: gym }, owners] = await Promise.all([
      admin.from('gyms').select('name, subscription_plan, subscription_current_period_end').eq('id', gymId).maybeSingle(),
      getGymOwnerEmails(admin, gymId),
    ]);
    if (!gym || owners.length === 0) return;
    await sendPlatformEmail({ to: owners, ...build(gym as BillingGym), template, idempotencyKey });
  } catch { /* fulfilment already succeeded — this is the second channel */ }
}

// charge.success for a platform subscription: record the payment (idempotent on
// reference) and advance the gym's paid-through. Also captures the Paystack
// customer/subscription codes so future recurring events resolve back here.
async function fulfillCharge(admin: Admin, data: Json): Promise<PlatformResult> {
  const reference = str(data.reference);
  if (!reference) return { ok: false, handled: true, error: 'missing reference', permanent: true };

  const meta = (data.metadata as Json) ?? {};
  const customer = (data.customer as Json) ?? {};
  const plan = (data.plan as Json) ?? {};
  const customerCode = str(customer.customer_code);
  const subscriptionCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);

  const gymId = await resolveGymId(admin, { metaGymId: str(meta.gym_id), subscriptionCode, customerCode });
  if (!gymId) return { ok: false, handled: true, error: 'could not resolve gym for charge', permanent: true };

  const tier = tierFromCharge(meta, plan);
  if (!tier) {
    return { ok: false, handled: true, error: 'unrecognized platform plan code' };
  }

  const amountKobo = Number(data.amount ?? 0);
  if (!settledAmountMatches(amountKobo, PLATFORM_PLANS[tier].amountKobo)) {
    return { ok: false, handled: true, error: 'platform charge amount does not match plan', permanent: true };
  }

  const paidAt = str(data.paid_at) ? new Date(String(data.paid_at)) : new Date();
  const periodEnd = addMonths(paidAt, 1);

  // Idempotency: fast-path pre-check, then the unique-index 23505 catch is the
  // real guard. Crucially, ONLY the writer that records the payment advances the
  // gym's period — the webhook and the /billing/callback self-heal fire for the
  // same charge and would otherwise each push a different period-end (they derive
  // paid_at differently). Whoever loses the race no-ops here.
  const { data: existing } = await admin.from('platform_payments').select('id').eq('paystack_reference', reference).maybeSingle();
  if (existing) return { ok: true, handled: true };

  const { error: payErr } = await admin.from('platform_payments').insert({
    gym_id: gymId,
    amount: amountKobo / 100,
    currency: 'NGN',
    payment_status: 'successful',
    paystack_reference: reference,
    plan: tier,
    billing_period_start: paidAt.toISOString().slice(0, 10),
    billing_period_end: periodEnd.toISOString().slice(0, 10),
  });
  if (payErr) {
    if (payErr.code === '23505') return { ok: true, handled: true }; // concurrent fulfiller won — no-op
    return { ok: false, handled: true, error: payErr.message };
  }

  // We recorded the payment → activate / extend the gym's subscription once.
  const patch: GymUpdate = {
    subscription_status: 'active',
    subscription_current_period_end: periodEnd.toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (tier) patch.subscription_plan = tier;
  if (customerCode) patch.paystack_customer_code = customerCode;
  if (subscriptionCode) patch.paystack_subscription_code = subscriptionCode;
  const { error: gymErr } = await admin.from('gyms').update(patch).eq('id', gymId);
  if (gymErr) {
    // Roll back the idempotency lock so a retry can re-attempt the activation,
    // mirroring the member-flow compensation.
    await admin.from('platform_payments').delete().eq('paystack_reference', reference);
    return { ok: false, handled: true, error: gymErr.message };
  }

  // Only the writer that recorded the payment gets here, so the receipt is sent
  // once per charge; the reference keys it so a Resend-side retry can't double
  // it either.
  await mailOwners(admin, gymId, (gym) => subscriptionReceipt({
    gymName: gym.name ?? 'your gym',
    amountNaira: amountKobo / 100,
    tier: planLabel(tier ?? gym.subscription_plan),
    paidDate: fmtDate(paidAt.toISOString()),
    periodEnd: fmtDate(periodEnd.toISOString()),
    reference,
    billingUrl: platformAppUrl('/admin/billing'),
  }), 'subscription_receipt', `platform-receipt-${reference}`);

  return { ok: true, handled: true };
}

// subscription.create: store the subscription + customer codes so we can match
// recurring charges and cancellations back to this gym. Deliberately does NOT
// set 'active' — only a recorded charge.success activates a gym, so a
// subscription.create can never grant access without a confirmed payment.
async function onSubscriptionCreate(admin: Admin, data: Json): Promise<PlatformResult> {
  const subscriptionCode = str(data.subscription_code);
  const customer = (data.customer as Json) ?? {};
  const customerCode = str(customer.customer_code);
  const gymId = await resolveGymId(admin, { customerCode, subscriptionCode });
  if (!gymId) return { ok: true, handled: true }; // first charge.success will link it; ack
  const patch: GymUpdate = { updated_at: new Date().toISOString() };
  if (subscriptionCode) patch.paystack_subscription_code = subscriptionCode;
  if (customerCode) patch.paystack_customer_code = customerCode;
  await admin.from('gyms').update(patch).eq('id', gymId);
  return { ok: true, handled: true };
}

async function setStatusBySubscription(admin: Admin, data: Json, status: 'past_due' | 'cancelled'): Promise<PlatformResult> {
  const subscriptionCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const customer = (data.customer as Json) ?? {};
  const gymId = await resolveGymId(admin, { subscriptionCode, customerCode: str(customer.customer_code) });
  if (!gymId) return { ok: true, handled: true };

  // Stale-event guard: a disable/dunning event names the subscription it is
  // about. If the gym has since re-subscribed, its stored code is the NEW
  // subscription — an event carrying a DIFFERENT code is about a superseded
  // subscription (a delayed retry or a replayed capture) and must not demote
  // the gym's current, paid state. Events without a code (rare) pass through.
  if (subscriptionCode) {
    const { data: gym } = await admin.from('gyms').select('paystack_subscription_code').eq('id', gymId).maybeSingle();
    const current = gym?.paystack_subscription_code ?? null;
    if (current && current !== subscriptionCode) return { ok: true, handled: true };
  }

  await admin.from('gyms').update({ subscription_status: status, updated_at: new Date().toISOString() }).eq('id', gymId);

  // Both states lock the console at a date the owner has no other way of
  // learning — the console itself is what stops opening.
  if (status === 'past_due') {
    const amountKobo = Number(data.amount ?? 0);
    // Keyed per subscription per DAY, not per event. Paystack dunning fires a
    // separate invoice.payment_failed for each retry, and the owner should hear
    // about a failing card — but once a day, not once per attempt. The date
    // stamp lets tomorrow's attempt through while collapsing a same-day retry
    // (and any webhook redelivery that slips past the replay ledger).
    const stamp = new Date().toISOString().slice(0, 10);
    await mailOwners(admin, gymId, (gym) => subscriptionPastDue({
      gymName: gym.name ?? 'your gym',
      amountNaira: (amountKobo > 0 ? amountKobo : planKobo(gym.subscription_plan)) / 100,
      tier: planLabel(gym.subscription_plan),
      attemptedDate: fmtDate(new Date().toISOString()),
      graceEndDate: accessUntil(gym.subscription_current_period_end),
      billingUrl: platformAppUrl('/admin/billing'),
    }), 'subscription_past_due', `platform-pastdue-${subscriptionCode ?? gymId}:${stamp}`);
  } else {
    // Keyed on the subscription so this and the owner-initiated cancel in
    // lib/actions/platform-billing.ts — which fire seconds apart for the same
    // cancellation — arrive as one email. Falls back to the gym id so the rare
    // code-less event is still deduped against its own redelivery.
    await mailOwners(admin, gymId, (gym) => subscriptionCancelled({
      gymName: gym.name ?? 'your gym',
      accessEndDate: accessUntil(gym.subscription_current_period_end),
      billingUrl: platformAppUrl('/admin/billing'),
    }), 'subscription_cancelled', `platform-cancelled-${subscriptionCode ?? gymId}`);
  }

  return { ok: true, handled: true };
}

// Top-level dispatcher the webhook calls once it knows the event is platform.
export async function handlePlatformEvent(event: Json): Promise<PlatformResult> {
  let admin: Admin;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, handled: true, error: (e as Error).message }; }

  const name = str(event.event) ?? '';
  const data = (event.data as Json) ?? {};
  switch (name) {
    case 'charge.success': return fulfillCharge(admin, data);
    case 'subscription.create': return onSubscriptionCreate(admin, data);
    case 'subscription.disable':
    case 'subscription.not_renew': return setStatusBySubscription(admin, data, 'cancelled');
    case 'invoice.payment_failed': return setStatusBySubscription(admin, data, 'past_due');
    default: return { ok: true, handled: true }; // invoice.create/update etc. — ack, no-op
  }
}
