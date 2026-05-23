import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';

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

  return NextResponse.json({ success: true, subscription, months });
}
