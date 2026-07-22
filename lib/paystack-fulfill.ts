import { createAdminClient } from '@/lib/supabase/admin';
import { extendDate, renewalBase } from '@/lib/plan-duration';
import { logAudit } from '@/lib/audit';
import { deliverReceipt, type NotifyGym } from '@/lib/notify';
import { captureServerEvent } from '@/lib/server-error';

export type ChargeData = { reference: string; amountKobo: number; channel: string | null; metadata: Record<string, unknown> };
// `permanent` marks a failure that won't succeed on retry (e.g. unusable
// metadata) so the webhook can ack instead of asking Paystack to resend.
export type FulfillResult = { ok: boolean; created: boolean; error?: string; permanent?: boolean };

// Idempotently record a successful Paystack charge and extend the member's
// subscription. Shared by the webhook AND the post-checkout callback — and
// Paystack fires both near-simultaneously for the same transaction, so this
// MUST be race-safe. Idempotency rests on a UNIQUE(paystack_reference) index
// (supabase/migrations/20260609_payments_paystack_reference_unique.sql): the
// pre-check is a fast path, the unique-violation catch is the real guard that
// stops a concurrent fulfiller from recording the payment / extending twice.
// Requires the service-role key (payments / member_subscriptions are RLS-locked).
export async function fulfillCharge(d: ChargeData): Promise<FulfillResult> {
  const meta = d.metadata ?? {};
  const memberId = meta.member_id as string | undefined;
  const gymId = meta.gym_id as string | undefined;
  const planId = (meta.plan_id as string | undefined) ?? null;
  // Clamp to a sane whole-month range. In the normal flow duration_months is
  // server-set at init (renew.ts) from the plan, but this helper is keyed only
  // on metadata — clamp so a tampered/garbage value can't extend a sub by years.
  const monthsRaw = Math.floor(Number(meta.duration_months ?? 1));
  const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(monthsRaw, 1), 36) : 1;
  // Daily/weekly plans carry duration_days (clamped) — it wins over months.
  const daysRaw = meta.duration_days != null ? Math.floor(Number(meta.duration_days)) : 0;
  const durationDays = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 366) : null;
  if (!memberId || !gymId) return { ok: false, created: false, error: 'missing member_id/gym_id in metadata', permanent: true };

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, created: false, error: (e as Error).message }; }

  // Fast path: already recorded (the common case when the webhook wins the race
  // before the callback runs, or vice versa).
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', d.reference).maybeSingle();
  if (existing) return { ok: true, created: false };

  // SECURITY: the duration above is read from charge metadata, which a member
  // who crafts their own Paystack transaction can set freely (e.g. pay ₦100 but
  // claim duration_months=36). When the metadata names a real plan in this gym,
  // the plan's OWN duration is authoritative — derive it from the DB so a
  // tampered metadata duration can't over-extend. We do NOT reject on amount
  // mismatch (a legitimate price change between checkout init and fulfilment
  // would otherwise strand a real, paid charge); the duration is what matters.
  let planMonths = months;
  let planDays = durationDays;
  let planPriceKobo: number | null = null;
  if (planId) {
    const { data: plan } = await admin.from('membership_plans')
      .select('duration_days, duration_months, price').eq('id', planId).eq('gym_id', gymId).maybeSingle();
    if (plan) {
      const pm = Math.floor(Number(plan.duration_months ?? 0));
      const pd = plan.duration_days != null ? Math.floor(Number(plan.duration_days)) : 0;
      planDays = Number.isFinite(pd) && pd > 0 ? Math.min(pd, 366) : null;
      planMonths = planDays ? 0 : (Number.isFinite(pm) && pm > 0 ? Math.min(pm, 36) : 1);
      const pp = Number(plan.price ?? 0);
      if (Number.isFinite(pp) && pp > 0) planPriceKobo = Math.round(pp * 100);
    }
  }

  const { error: payErr } = await admin.from('payments').insert({
    member_id: memberId, gym_id: gymId, plan_id: planId,
    amount: d.amountKobo / 100, currency: 'NGN',
    status: 'success', payment_status: 'successful',
    payment_method: d.channel ?? 'paystack', paystack_reference: d.reference,
    payment_date: new Date().toISOString(),
  });
  if (payErr) {
    // 23505 = unique_violation: a concurrent fulfiller recorded this reference
    // between our pre-check and insert. Idempotent no-op, not a failure — and
    // crucially, we must NOT fall through to extend the subscription again.
    if (payErr.code === '23505') return { ok: true, created: false };
    return { ok: false, created: false, error: payErr.message };
  }

  // We are the writer that recorded the payment → extend (or create) the sub once.
  const { data: sub } = await admin.from('member_subscriptions')
    .select('id, end_date').eq('member_id', memberId).eq('gym_id', gymId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  // Stack onto the current period when one is still running (buy = next period),
  // else start today. Shared rule — see renewalBase().
  const base = renewalBase(sub?.end_date);
  const newEnd = extendDate(base, { duration_days: planDays, duration_months: planMonths });
  const endIso = newEnd.toISOString().slice(0, 10);
  const { error: subErr } = sub
    ? await admin.from('member_subscriptions').update({ end_date: endIso, plan_id: planId ?? undefined, updated_at: new Date().toISOString() }).eq('id', sub.id)
    : await admin.from('member_subscriptions').insert({ member_id: memberId, gym_id: gymId, plan_id: planId, status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: endIso });
  if (subErr) {
    // The member paid but the extension failed. The payment row we just
    // inserted is the idempotency lock — if we left it, every retry would
    // no-op at the pre-check and the member would stay unextended. Compensate:
    // remove the payment row and report failure so the webhook 500s and
    // Paystack retries the whole fulfillment.
    await admin.from('payments').delete().eq('paystack_reference', d.reference);
    return { ok: false, created: false, error: `subscription extend failed: ${subErr.message}` };
  }

  // The fulfillment path deliberately does not REJECT on amount mismatch (see
  // security note above) — but a mismatch is still worth surfacing. If the plan's
  // priced amount differs from what the charge actually settled for, write an
  // audit trail so an underpayment (or refund-window arbitrage) is at least
  // observable in /superadmin/audit. Best-effort; never fails the fulfilment.
  if (planPriceKobo && planPriceKobo !== d.amountKobo) {
    void logAudit({
      action: 'payment_amount_mismatch',
      table: 'payments',
      gymId, recordId: memberId,
      values: {
        paystack_reference: d.reference,
        plan_id: planId,
        expected_kobo: planPriceKobo,
        received_kobo: d.amountKobo,
        delta_kobo: d.amountKobo - planPriceKobo,
      },
    });
    // Underpayment is the one accepted-by-design fraud vector — an audit row
    // alone is passive. Page it (inert without SENTRY_DSN) when the charge
    // settled for LESS than the plan price, so a pattern gets noticed.
    if (d.amountKobo < planPriceKobo) {
      void captureServerEvent('underpayment accepted on member charge', {
        paystack_reference: d.reference,
        gym_id: gymId,
        plan_id: planId,
        expected_kobo: planPriceKobo,
        received_kobo: d.amountKobo,
      });
    }
  }

  const { error: notifErr } = await admin.from('notifications').insert({
    gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
    title: 'Payment received', body: `₦${(d.amountKobo / 100).toLocaleString('en-NG')} received — membership renewed.`,
  });
  if (notifErr) console.warn(`[fulfill] receipt notification failed for ${d.reference}: ${notifErr.message}`); // non-critical

  // Email receipt (respects the gym's payment-receipts toggle; inert without
  // RESEND_API_KEY). Best-effort like the in-app row — never fails fulfilment.
  try {
    const [{ data: contact }, { data: gymRow }] = await Promise.all([
      admin.from('profiles').select('email, phone, full_name').eq('id', memberId).maybeSingle(),
      admin.from('gyms').select('id, name, subscription_plan, notif_payment_receipts').eq('id', gymId).maybeSingle(),
    ]);
    if (contact && gymRow) {
      await deliverReceipt(
        gymRow as unknown as NotifyGym,
        { email: contact.email, phone: contact.phone, fullName: contact.full_name },
        { amountNaira: d.amountKobo / 100, endDate: endIso },
      );
    }
  } catch { /* delivery is a bonus channel */ }
  return { ok: true, created: true };
}
