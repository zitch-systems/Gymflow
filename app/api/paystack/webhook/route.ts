import { createHmac } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Paystack webhook. Verifies the x-paystack-signature (HMAC-SHA512 of the raw
// body with the secret key), then on charge.success records the payment and
// extends the member's subscription. Writes use the service-role admin client
// (payments / member_subscriptions inserts are service-role-only by RLS).
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';
  const expected = createHmac('sha512', secret).update(raw).digest('hex');
  if (signature !== expected) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });

  const event = JSON.parse(raw);
  if (event?.event !== 'charge.success') return NextResponse.json({ received: true });

  const d = event.data ?? {};
  const meta = d.metadata ?? {};
  const memberId = meta.member_id as string | undefined;
  const gymId = meta.gym_id as string | undefined;
  const planId = meta.plan_id as string | undefined;
  const months = Number(meta.duration_months ?? 1);
  if (!memberId || !gymId) return NextResponse.json({ received: true });

  const admin = createAdminClient();

  // Idempotency: skip if this reference is already recorded.
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', d.reference).maybeSingle();
  if (existing) return NextResponse.json({ received: true, duplicate: true });

  await admin.from('payments').insert({
    member_id: memberId,
    gym_id: gymId,
    plan_id: planId ?? null,
    amount: Number(d.amount ?? 0) / 100,
    currency: 'NGN',
    payment_status: 'successful',
    payment_method: d.channel ?? 'paystack',
    paystack_reference: d.reference,
    payment_date: new Date().toISOString(),
  });

  // Extend (or create) the active subscription by the plan's duration.
  const { data: sub } = await admin
    .from('member_subscriptions')
    .select('id, end_date')
    .eq('member_id', memberId).eq('gym_id', gymId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();

  const base = sub?.end_date && new Date(sub.end_date) > new Date() ? new Date(sub.end_date) : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + months);
  const endIso = newEnd.toISOString().slice(0, 10);

  if (sub) {
    await admin.from('member_subscriptions').update({ end_date: endIso, plan_id: planId ?? undefined, updated_at: new Date().toISOString() }).eq('id', sub.id);
  } else {
    await admin.from('member_subscriptions').insert({
      member_id: memberId, gym_id: gymId, plan_id: planId ?? null, status: 'active',
      start_date: new Date().toISOString().slice(0, 10), end_date: endIso,
    });
  }

  return NextResponse.json({ received: true });
}
