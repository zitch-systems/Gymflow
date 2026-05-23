import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';

type VerifyBody = {
  reference?: string;
  gym_id?: string;
  plan_id?: string | null;
  amount?: number;
  end_date?: string; // ISO date for the new membership period
  payment_method?: string;
};

export async function POST(request: Request) {
  let body: VerifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { reference, gym_id, plan_id, amount, end_date, payment_method = 'card' } = body;
  if (!reference || !gym_id || !end_date) {
    return NextResponse.json({ error: 'reference, gym_id and end_date required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  // Belt-and-braces: tie verified email to signed-in user to prevent ref-stuffing.
  if (txn.customer?.email !== user.email) {
    return NextResponse.json({ error: 'Email on payment does not match account' }, { status: 403 });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .insert({
      member_id: user.id,
      gym_id,
      plan_id: plan_id ?? null,
      status: 'active',
      start_date: today,
      end_date,
      auto_debit_enabled: false,
    })
    .select()
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: `Membership create failed: ${membershipError.message}` }, { status: 500});
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    gym_id,
    member_id: user.id,
    plan_id: plan_id ?? null,
    amount: amount ?? txn.amount / 100,
    currency: txn.currency ?? 'NGN',
    payment_method,
    payment_status: 'successful',
    paystack_reference: reference,
    paystack_authorization_code: txn.authorization?.authorization_code ?? null,
    payment_date: new Date().toISOString(),
  });

  if (paymentError) {
    return NextResponse.json({ error: `Payment record failed: ${paymentError.message}` }, { status: 500 });
  }

  const auth = txn.authorization;
  let savedCard = false;
  if (auth?.reusable && auth.authorization_code) {
    const { error: cardError } = await supabase.from('saved_cards').insert({
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
    });
    savedCard = !cardError;
  }

  return NextResponse.json({
    success: true,
    membership,
    saved_card: savedCard,
  });
}
