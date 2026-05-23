import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';
import { sendReceipt } from '@/lib/email';
import { waReceipt } from '@/lib/whatsapp';

type Body = {
  reference?: string;
  gym_id?: string;
  instructor_id?: string;
  amount?: number;
  months?: number;
  end_date?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { reference, gym_id, instructor_id, amount, months, end_date } = body;
  if (!reference || !gym_id || !instructor_id || !end_date) {
    return NextResponse.json({ error: 'reference, gym_id, instructor_id, end_date required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  if (txn.customer?.email !== user.email) {
    return NextResponse.json({ error: 'Email on payment does not match account' }, { status: 403 });
  }

  // Idempotency: if we've already recorded this reference, return success.
  const { data: existing } = await supabase
    .from('instructor_subscriptions')
    .select('id')
    .eq('payment_reference', reference)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ success: true, subscription: existing, already: true });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: subscription, error: subError } = await supabase
    .from('instructor_subscriptions')
    .insert({
      gym_id,
      instructor_id,
      member_id: user.id,
      status: 'active',
      start_date: today,
      end_date,
      amount_paid: amount ?? txn.amount / 100,
      payment_reference: reference,
    })
    .select()
    .maybeSingle();

  if (subError) {
    return NextResponse.json({ error: `Subscription create failed: ${subError.message}` }, { status: 500 });
  }

  // Also record in payments for the gym's wallet history.
  await supabase.from('payments').insert({
    gym_id,
    member_id: user.id,
    amount: amount ?? txn.amount / 100,
    currency: txn.currency ?? 'NGN',
    payment_method: 'card',
    payment_status: 'successful',
    paystack_reference: reference,
    paystack_authorization_code: txn.authorization?.authorization_code ?? null,
    payment_date: new Date().toISOString(),
  });

  // Also save the card so instructor sub can auto-renew later.
  const auth = txn.authorization;
  if (auth?.reusable && auth.authorization_code) {
    await supabase.from('saved_cards').upsert(
      {
        gym_id,
        member_id: user.id,
        authorization_code: auth.authorization_code,
        paystack_authorization_code: auth.authorization_code,
        card_type: auth.card_type ?? null,
        last4: auth.last4 ?? null,
        exp_month: auth.exp_month ?? null,
        exp_year: auth.exp_year ?? null,
        bank: auth.bank ?? null,
        brand: auth.brand ?? null,
        reusable: auth.reusable ?? true,
        email: txn.customer.email,
        is_default: true,
        is_active: true,
      },
      { onConflict: 'member_id,authorization_code' },
    );
  }

  // Receipt notifications (fire-and-forget).
  try {
    const [{ data: profile }, { data: instructor }] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, first_name, phone, email')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', instructor_id)
        .maybeSingle(),
    ]);
    const name = profile?.full_name ?? profile?.first_name ?? 'Member';
    const planName = `Coaching: ${instructor?.full_name ?? 'Instructor'}`;
    const paid = amount ?? txn.amount / 100;
    await Promise.allSettled([
      sendReceipt(user.email!, { name, amount: paid, plan: planName, endDate: end_date }),
      profile?.phone ? waReceipt(profile.phone, { name, amount: paid, endDate: end_date }) : Promise.resolve(),
    ]);
  } catch (e) {
    console.warn('[GF verify-instructor] receipt notification failed:', (e as Error).message);
  }

  return NextResponse.json({ success: true, subscription, months });
}
