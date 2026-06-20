import { createAdminClient } from '@/lib/supabase/admin';

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
  if (!memberId || !gymId) return { ok: false, created: false, error: 'missing member_id/gym_id in metadata', permanent: true };

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, created: false, error: (e as Error).message }; }

  // Fast path: already recorded (the common case when the webhook wins the race
  // before the callback runs, or vice versa).
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', d.reference).maybeSingle();
  if (existing) return { ok: true, created: false };

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
  const base = sub?.end_date && new Date(sub.end_date) > new Date() ? new Date(sub.end_date) : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + months);
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

  const { error: notifErr } = await admin.from('notifications').insert({
    gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
    title: 'Payment received', body: `₦${(d.amountKobo / 100).toLocaleString('en-NG')} received — membership renewed.`,
  });
  if (notifErr) console.warn(`[fulfill] receipt notification failed for ${d.reference}: ${notifErr.message}`); // non-critical
  return { ok: true, created: true };
}
