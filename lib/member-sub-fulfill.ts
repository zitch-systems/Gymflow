import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { settleMemberCharge } from '@/lib/member-charge';
import { logAudit } from '@/lib/audit';
import { deliverReceipt, deliverPaymentFailed, type NotifyGym } from '@/lib/notify';
import { firstName, fmtDate, watDateISO } from '@/lib/format';
import { GYM_EMAIL_COLUMNS } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, autoRenewEnabled, autoRenewEnded } from '@/lib/email/templates/member';
import { resolveTrainerOptIn } from '@/lib/plan-addon';
import { readSplit } from '@/lib/paystack-split';
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

  // Paystack can echo our metadata on the first charge AND on
  // subscription.create. Classify it before code lookups so the create event
  // is not accidentally acknowledged by the platform-subscription handler.
  const kind = str(meta.kind);
  if (kind === 'member_subscription') return true;

  // Any OTHER explicit kind (membership_renewal, platform_subscription)
  // belongs to a different flow. Without this, a member who also has an
  // auto-renew customer code could have an unrelated event misrouted here.
  if (kind) return false;

  if (name === 'charge.success') {
    // Metadata-less charge.success is only ours if it's a subscription cycle,
    // and Paystack always attaches the plan object to those.
    if (!str((data.plan as Json)?.plan_code)) return false;
  } else if (!name.startsWith('subscription.') && !name.startsWith('invoice.')) {
    return false;
  }

  // No metadata to go on — match by subscription_code / customer_code
  // against member_subscriptions.

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
  // A subscription code identifies one mandate and is always the strongest key.
  if (subCode) {
    const { data } = await admin.from('member_subscriptions').select('*').eq('paystack_subscription_code', subCode).limit(1).maybeSingle();
    if (data) return data;
  }

  // The first charge carries the member/gym metadata we stamped at
  // initialization, while its new subscription code is not stored yet. Prefer
  // that pair over customer_code: one Paystack customer can hold subscriptions
  // for several gyms, so "latest row for this customer" can credit the wrong
  // tenant.
  if (metaMemberId && metaGymId) {
    const { data } = await admin
      .from('member_subscriptions').select('*')
      .eq('member_id', metaMemberId).eq('gym_id', metaGymId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }

  if (custCode) {
    // Customer code is only safe when it resolves to exactly one local row.
    // Ambiguity is a retryable reconciliation problem, not permission to pick
    // whichever subscription happened to be created last.
    const { data } = await admin.from('member_subscriptions')
      .select('*').eq('paystack_customer_code', custCode)
      .order('created_at', { ascending: false }).limit(2);
    if (data?.length === 1) return data[0];
  }
  return null;
}

// Shared lookup + external delivery for the auto-billing lifecycle emails.
// Best-effort: a delivery problem must never fail the webhook fulfilment.
async function emailMember(
  admin: Admin,
  gymId: string,
  memberId: string,
  send: (gym: NotifyGym, contact: { email: string | null; phone: string | null; fullName: string | null }) => Promise<unknown>,
): Promise<void> {
  // Two service-role reads inside a payment webhook are not worth paying for
  // when the sender is going to skip anyway.
  if (!process.env.RESEND_API_KEY) return;
  try {
    const [{ data: contact }, { data: gym }] = await Promise.all([
      admin.from('profiles').select('email, phone, full_name').eq('id', memberId).maybeSingle(),
      // GYM_EMAIL_COLUMNS rather than just the toggles: these messages carry the
      // gym's logo, colour and subdomain, and a narrow select quietly sends them
      // dressed as GymFlow with links pointing at the wrong host.
      admin.from('gyms').select(GYM_EMAIL_COLUMNS).eq('id', gymId).maybeSingle(),
    ]);
    if (!contact || !gym) return;
    await send(gym as unknown as NotifyGym, { email: contact.email, phone: contact.phone, fullName: contact.full_name });
  } catch { /* bonus channel */ }
}

// Did this mandate include the private-trainer add-on? Only the events that
// carry our checkout metadata can answer — Paystack drops metadata after the
// first cycle — so `null` means "no opinion, leave the stored flag alone"
// rather than "no trainer". Later cycles need no opinion: the mandate is bound
// to the with-trainer Paystack Plan, so the flag set on the first charge stays
// true for as long as the subscription bills that amount.
async function trainerOptInFromMeta(
  admin: Admin,
  gymId: string,
  planId: string | null,
  requested: unknown,
): Promise<boolean | null> {
  if (requested === undefined) return null;
  if (!planId) return null;
  const { data: plan } = await admin.from('membership_plans')
    .select('trainer_addon_enabled, trainer_addon_price').eq('id', planId).eq('gym_id', gymId).maybeSingle();
  if (!plan) return null;
  return resolveTrainerOptIn(plan, requested);
}

// The plan name as the MEMBER knows it. Paystack's own plan object is named
// "<plan> (auto-renew)" (see ensurePlanCode in lib/actions/member-billing.ts),
// which is our plumbing showing through in a message they read.
async function planNameOf(admin: Admin, planId: string | null): Promise<string | null> {
  if (!planId) return null;
  const { data } = await admin.from('membership_plans').select('name').eq('id', planId).maybeSingle();
  return data?.name ?? null;
}

// Paystack's billing intervals in the house voice. An unknown interval yields
// null and the row is dropped rather than printing a raw enum at a member.
const INTERVAL_LABELS: Record<string, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  biannually: 'Every 6 months',
  annually: 'Every year',
};

// Stale-event guard for status-flip events. findSub's customer_code fallback
// returns the member's LATEST subscription row — so a delayed or replayed
// disable/dunning event for an OLD (superseded) subscription would otherwise
// land on the member's current one. If the event names a subscription and the
// resolved row is bound to a DIFFERENT one, the event is about a subscription
// we no longer track: no-op.
function isStaleFor(sub: { paystack_subscription_code: string | null }, eventSubCode: string | null): boolean {
  return Boolean(eventSubCode && sub.paystack_subscription_code && sub.paystack_subscription_code !== eventSubCode);
}

// subscription.create: cache the codes so future recurring events resolve back
// to this member and cancel calls have what Paystack needs.
async function onSubscriptionCreate(admin: Admin, data: Json): Promise<Result> {
  const subCode = str(data.subscription_code);
  const emailToken = str(data.email_token);
  const customer = (data.customer as Json) ?? {};
  const custCode = str(customer.customer_code);
  const meta = (data.metadata as Json) ?? {};

  const sub = await findSub(admin, subCode, custCode, str(meta.member_id), str(meta.gym_id));
  if (!sub) return { ok: false, handled: true, error: 'Initial member charge has not created its subscription yet' };
  if (
    subCode &&
    sub.paystack_subscription_code &&
    sub.paystack_subscription_code !== subCode &&
    sub.auto_debit_enabled
  ) {
    return { ok: true, handled: true }; // delayed create for a superseded mandate
  }

  const patch: MemberSubUpdate = { updated_at: new Date().toISOString(), auto_debit_enabled: true };
  if (subCode) patch.paystack_subscription_code = subCode;
  if (emailToken) patch.paystack_email_token = emailToken;
  if (custCode) patch.paystack_customer_code = custCode;
  const trainer = await trainerOptInFromMeta(admin, sub.gym_id, str(meta.plan_id) ?? sub.plan_id, meta.trainer_addon);
  if (trainer !== null) patch.trainer_addon = trainer;

  const { error } = await admin.from('member_subscriptions').update(patch).eq('id', sub.id);
  if (error) return { ok: false, handled: true, error: error.message };

  // A standing mandate to charge someone's card now exists. Telling them the
  // amount, the date and where the off switch is belongs in the same beat —
  // the alternative is that they find out from a bank alert. Paystack's payload
  // is the authority on what will actually be charged and when; our own plan row
  // only supplies the name the member recognises.
  const plan = (data.plan as Json) ?? {};
  const amountKobo = Number(data.amount ?? plan.amount ?? 0);
  const nextCharge = str(data.next_payment_date) ?? sub.end_date;
  const spec = MEMBER_TEMPLATES.autoRenewEnabled;
  // The plan read sits INSIDE the callback so it only runs once emailMember has
  // cleared its RESEND_API_KEY check and actually found someone to write to.
  await emailMember(admin, sub.gym_id, sub.member_id, async (gym, contact) => sendGymEmail({
    gym,
    to: { email: contact.email, fullName: contact.fullName },
    template: spec.template,
    category: spec.category,
    ...autoRenewEnabled({
      gymName: gym.name ?? 'Your gym',
      firstName: firstName(contact.fullName),
      amountNaira: amountKobo / 100,
      nextChargeDate: fmtDate(nextCharge),
      manageUrl: memberAppUrl(gym, '/dashboard/profile'),
      planName: await planNameOf(admin, sub.plan_id ?? null),
      intervalLabel: INTERVAL_LABELS[str(plan.interval) ?? ''] ?? null,
    }),
    // Paystack redelivers subscription.create on its own retry schedule, and the
    // update above is idempotent, so nothing else here stops a second send.
    idempotencyKey: subCode ? `auto_renew_on:${subCode}` : undefined,
  }));

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

  const { data: reserved, error: reservationError } = await admin
    .from('member_payment_checkouts' as never).select('*').eq('reference', reference).maybeSingle();
  if (reservationError) return { ok: false, handled: true, error: reservationError.message };
  const checkout = reserved as unknown as {
    gym_id: string; member_id: string; plan_id: string; trainer_addon: boolean;
    duration_days: number | null; duration_months: number | null;
    provider_plan_code: string | null;
  } | null;
  const gymId = checkout?.gym_id ?? str(meta.gym_id);
  const memberId = checkout?.member_id ?? str(meta.member_id);
  const sub = await findSub(admin, subCode, custCode, memberId, gymId);
  if (!sub && !checkout) return { ok: false, handled: true, error: 'could not resolve member subscription or checkout' };
  const boundGymId = checkout?.gym_id ?? sub!.gym_id;
  const boundMemberId = checkout?.member_id ?? sub!.member_id;
  if (
    subCode &&
    sub?.paystack_subscription_code &&
    sub.paystack_subscription_code !== subCode &&
    sub.auto_debit_enabled
  ) {
    return {
      ok: false, handled: true, permanent: true,
      error: 'subscription code conflicts with active mandate',
    };
  }

  const amountKobo = Number(data.amount ?? 0);
  // A recurring charge must carry a real, positive amount before it records a
  // successful payment and extends access. The one-off and platform rails both
  // fail closed on amount; this one did not, so an `amount: 0` (or NaN/negative)
  // charge.success would grant a full billing period for free. Reject it as
  // handled — a retry with the same bad amount would repeat, so don't ask
  // Paystack to redeliver.
  if (data.currency !== 'NGN') return { ok: false, handled: true, error: 'unexpected recurring currency', permanent: true };
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return { ok: false, handled: true, error: `recurring charge has a non-positive amount (${data.amount})` };
  }

  // Load the plan's duration to extend end_date correctly. We prefer the sub's
  // own plan_id (survives if the membership_plans row is later archived) and
  // fall back to metadata.plan_id.
  const planId = checkout?.plan_id ?? sub?.plan_id ?? str(meta.plan_id);
  let extendBy = { duration_days: null as number | null, duration_months: 1 as number | null };
  if (planId) {
    const { data: plan } = await admin.from('membership_plans')
      .select('duration_days, duration_months, paystack_plan_code, paystack_plan_code_trainer').eq('id', planId).eq('gym_id', boundGymId).maybeSingle();
    if (!plan) return { ok: false, handled: true, error: 'recurring plan is missing' };
    const providerPlan = (data.plan as Json) ?? {};
    const providerCode = str(providerPlan.plan_code);
    const boundMandate = Boolean(subCode && sub?.paystack_subscription_code === subCode);
    const approvedCodes = checkout?.provider_plan_code
      ? [checkout.provider_plan_code] : [plan.paystack_plan_code, plan.paystack_plan_code_trainer];
    if (!boundMandate && (!providerCode || !approvedCodes.includes(providerCode))) {
      return { ok: false, handled: true, error: 'recurring charge is not bound to the gym plan', permanent: true };
    }
    if (Number(providerPlan.amount) !== amountKobo || providerPlan.currency !== 'NGN') {
      return { ok: false, handled: true, error: 'recurring charge does not match provider plan', permanent: true };
    }
    // Later cycles use the interval actually sold at Paystack; a staff edit to
    // the local plan must not shorten an existing monthly mandate to one day.
    const providerPeriods: Record<string, typeof extendBy> = {
      daily: { duration_days: 1, duration_months: null }, weekly: { duration_days: 7, duration_months: null },
      monthly: { duration_days: null, duration_months: 1 }, quarterly: { duration_days: null, duration_months: 3 },
      biannually: { duration_days: null, duration_months: 6 }, annually: { duration_days: null, duration_months: 12 },
    };
    extendBy = checkout
      ? { duration_days: checkout.duration_days, duration_months: checkout.duration_months }
      : providerPeriods[str(providerPlan.interval) ?? ''];
    if (!extendBy) return { ok: false, handled: true, error: 'Provider billing interval needs reconciliation' };
  }

  // Bind the codes on the first successful charge. subscription.create can
  // arrive before the row is resolvable and used to be acknowledged without
  // storing them; subsequent renewals then had no safe key and were lost.
  // Bind after atomic settlement creates the first row. A replay repairs a
  // failed code write without extending the paid term again.
  const codePatch: MemberSubUpdate = { auto_debit_enabled: true, updated_at: new Date().toISOString() };
  if (subCode) codePatch.paystack_subscription_code = subCode;
  if (custCode) codePatch.paystack_customer_code = custCode;
  const trainer = checkout?.trainer_addon ?? await trainerOptInFromMeta(admin, boundGymId, planId, meta.trainer_addon);
  if (trainer !== null) codePatch.trainer_addon = trainer;
  if (!planId) return { ok: false, handled: true, error: 'recurring plan is missing' };
  const settled = await settleMemberCharge(admin, {
    reference, gymId: boundGymId, memberId: boundMemberId, planId,
    amountKobo, currency: 'NGN', period: extendBy, trainerAddon: trainer,
    method: 'auto_debit', split: readSplit(data), subscriptionId: sub?.id,
  });
  if (!settled.ok) return { ok: false, handled: true, error: settled.error };
  const { data: paidSub, error: paidSubError } = await admin.from('member_subscriptions').select('id')
    .eq('gym_id', boundGymId).eq('member_id', boundMemberId)
    .in('status', ['active', 'past_due', 'paused', 'pause_requested']).limit(1).maybeSingle();
  if (paidSubError || !paidSub) return { ok: false, handled: true, error: 'Could not bind paid member mandate' };
  const { error: codeErr } = await admin.from('member_subscriptions').update(codePatch).eq('id', paidSub.id);
  if (codeErr) return { ok: false, handled: true, error: `subscription code bind failed: ${codeErr.message}` };
  if (!settled.created) return { ok: true, handled: true };
  const newEnd = settled.endDate!;

  // Best-effort receipt notification.
  await admin.from('notifications').insert({
    gym_id: boundGymId, user_id: boundMemberId, type: 'payment', channel: 'in_app',
    title: 'Membership renewed', body: `₦${(amountKobo / 100).toLocaleString('en-NG')} auto-debited — access extended to ${newEnd}.`,
  });
  await emailMember(admin, boundGymId, boundMemberId, (gym, contact) =>
    deliverReceipt(gym, contact, { amountNaira: amountKobo / 100, endDate: newEnd }));

  return { ok: true, handled: true };
}

// invoice.payment_failed: enter grace state. The member sees a dashboard banner
// and can retry manually; Paystack continues its own retry schedule.
async function onPaymentFailed(admin: Admin, data: Json): Promise<Result> {
  const subCode = str(data.subscription_code) ?? str((data.subscription as Json)?.subscription_code);
  const customer = (data.customer as Json) ?? {};
  const sub = await findSub(admin, subCode, str(customer.customer_code), null, null);
  if (!sub) return { ok: true, handled: true };
  if (isStaleFor(sub, subCode)) return { ok: true, handled: true };

  const { error: statusErr } = await admin.from('member_subscriptions').update({
    status: 'past_due', updated_at: new Date().toISOString(),
  }).eq('id', sub.id).in('status', ['active', 'past_due']);
  if (statusErr) return { ok: false, handled: true, error: statusErr.message };

  await admin.from('notifications').insert({
    gym_id: sub.gym_id, user_id: sub.member_id, type: 'warning', channel: 'in_app',
    title: 'Payment failed', body: 'Your auto-renew charge didn\'t go through. Update your card in the app to keep access.',
  });
  await emailMember(admin, sub.gym_id, sub.member_id, (gym, contact) => deliverPaymentFailed(gym, contact));

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
  if (isStaleFor(sub, subCode)) return { ok: true, handled: true };

  const stillPaid = sub.end_date && sub.end_date >= watDateISO();
  // Turning off a card mandate does not resume a freeze or revoke the last
  // paid calendar day. Preserve an intentional pause until the gym resumes it.
  const newStatus = sub.status === 'paused' || sub.status === 'pause_requested' || sub.status === 'cancelled'
    ? sub.status : stillPaid ? 'active' : 'expired';

  // Ending a mandate always clears billing, but a concurrent staff freeze or
  // cancellation must not be overwritten by the status snapshot read above.
  const { error: statusErr } = await admin.from('member_subscriptions').update({
    auto_debit_enabled: false, updated_at: new Date().toISOString(),
  }).eq('id', sub.id);
  if (statusErr) return { ok: false, handled: true, error: statusErr.message };
  const { error: endErr } = await admin.from('member_subscriptions').update({
    status: newStatus, updated_at: new Date().toISOString(),
  }).eq('id', sub.id).eq('status', sub.status ?? '');
  if (endErr) return { ok: false, handled: true, error: endErr.message };

  // The mandate is gone either way — whether access lapsed with it or still has
  // paid-for time on it. Silence here is how a member discovers the card stopped
  // renewing by being turned away at the door.
  const spec = MEMBER_TEMPLATES.autoRenewEnded;
  await emailMember(admin, sub.gym_id, sub.member_id, async (gym, contact) => sendGymEmail({
    gym,
    to: { email: contact.email, fullName: contact.fullName },
    template: spec.template,
    category: spec.category,
    ...autoRenewEnded({
      gymName: gym.name ?? 'Your gym',
      firstName: firstName(contact.fullName),
      endDate: fmtDate(sub.end_date),
      renewUrl: memberAppUrl(gym, '/dashboard/renew'),
      planName: await planNameOf(admin, sub.plan_id ?? null),
    }),
    // subscription.disable and subscription.not_renew can both land for the same
    // subscription, and Paystack retries each of them.
    idempotencyKey: subCode ? `auto_renew_ended:${subCode}` : undefined,
  }));

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
