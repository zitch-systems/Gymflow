import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPlanTier, PLATFORM_PLANS, type PlanTier } from '@/lib/platform-plans';
import type { Database } from '@/lib/database.types';

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
  // limit(1), not maybeSingle(): a customer_code can be shared across a multi-gym
  // owner, and maybeSingle() would ERROR on >1 row (silently dropping the event).
  const { data } = await admin.from('gyms').select('id').eq(column, value).limit(1);
  return data && data[0] ? data[0].id : null;
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
  const amountKobo = Number(data.amount ?? 0);
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
