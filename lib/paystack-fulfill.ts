import { createAdminClient } from '@/lib/supabase/admin';

export type ChargeData = { reference: string; amountKobo: number; channel: string | null; metadata: Record<string, unknown> };

// Idempotently record a successful Paystack charge and extend the member's
// subscription. Shared by the webhook and the post-checkout callback, so a
// payment is fulfilled even if the Paystack webhook isn't configured. Requires
// the service-role key (payments / member_subscriptions writes are RLS-locked).
export async function fulfillCharge(d: ChargeData): Promise<{ ok: boolean; created: boolean; error?: string }> {
  const meta = d.metadata ?? {};
  const memberId = meta.member_id as string | undefined;
  const gymId = meta.gym_id as string | undefined;
  const planId = (meta.plan_id as string | undefined) ?? null;
  const months = Number(meta.duration_months ?? 1) || 1;
  if (!memberId || !gymId) return { ok: false, created: false, error: 'missing metadata' };

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, created: false, error: (e as Error).message }; }

  // Idempotency: skip if this reference is already recorded.
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', d.reference).maybeSingle();
  if (existing) return { ok: true, created: false };

  const { error: payErr } = await admin.from('payments').insert({
    member_id: memberId, gym_id: gymId, plan_id: planId,
    amount: d.amountKobo / 100, currency: 'NGN',
    status: 'success', payment_status: 'successful',
    payment_method: d.channel ?? 'paystack', paystack_reference: d.reference,
    payment_date: new Date().toISOString(),
  });
  if (payErr) return { ok: false, created: false, error: payErr.message };

  const { data: sub } = await admin.from('member_subscriptions')
    .select('id, end_date').eq('member_id', memberId).eq('gym_id', gymId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  const base = sub?.end_date && new Date(sub.end_date) > new Date() ? new Date(sub.end_date) : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + months);
  const endIso = newEnd.toISOString().slice(0, 10);
  if (sub) {
    await admin.from('member_subscriptions').update({ end_date: endIso, plan_id: planId ?? undefined, updated_at: new Date().toISOString() }).eq('id', sub.id);
  } else {
    await admin.from('member_subscriptions').insert({ member_id: memberId, gym_id: gymId, plan_id: planId, status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: endIso });
  }

  await admin.from('notifications').insert({
    gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
    title: 'Payment received', body: `₦${(d.amountKobo / 100).toLocaleString('en-NG')} received — membership renewed.`,
  });
  return { ok: true, created: true };
}
