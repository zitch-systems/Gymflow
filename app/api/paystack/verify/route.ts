import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';
import { sendReceipt } from '@/lib/email';
import { waReceipt } from '@/lib/whatsapp';

type VerifyBody = {
  reference?: string;
  plan_id?: string;
  payment_method?: string;
};

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split('T')[0];
}

export async function POST(request: Request) {
  let body: VerifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { reference, plan_id, payment_method = 'card' } = body;
  if (!reference || !plan_id) {
    return NextResponse.json({ error: 'reference and plan_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Idempotency: never process the same Paystack reference twice. A replayed
  // reference must not mint a second membership.
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (existingPayment) {
    return NextResponse.json({ success: true, already: true });
  }

  // The plan is the source of truth for gym, price, and duration — NEVER the
  // client. This prevents tampering with amount / end_date / gym_id.
  const { data: plan } = await supabase
    .from('membership_plans')
    .select('id, gym_id, name, price, duration_months, is_active')
    .eq('id', plan_id)
    .maybeSingle();
  if (!plan || plan.is_active === false) {
    return NextResponse.json({ error: 'Plan not found or inactive' }, { status: 400 });
  }
  const gym_id = plan.gym_id as string;
  const price = Number(plan.price);
  const durationMonths = Number(plan.duration_months ?? 1);

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  // Tie the verified email to the signed-in user to prevent reference stuffing.
  if (txn.customer?.email !== user.email) {
    return NextResponse.json({ error: 'Payment does not match your account' }, { status: 403 });
  }
  // Verify the money actually charged matches the plan, in Naira.
  if ((txn.currency ?? 'NGN') !== 'NGN') {
    return NextResponse.json({ error: 'Unsupported payment currency' }, { status: 400 });
  }
  if (Number(txn.amount) < Math.round(price * 100)) {
    return NextResponse.json({ error: 'Amount paid is less than the plan price' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];

  // Support pay-ahead: stack on top of the member's current active period.
  const { data: current } = await supabase
    .from('memberships')
    .select('end_date')
    .eq('member_id', user.id)
    .eq('gym_id', gym_id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = current?.end_date && current.end_date > today ? current.end_date : today;
  const end_date = addMonths(base, durationMonths);

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .insert({
      member_id: user.id,
      gym_id,
      plan_id,
      status: 'active',
      start_date: today,
      end_date,
      auto_debit_enabled: false,
    })
    .select()
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: `Membership create failed: ${membershipError.message}` }, { status: 500 });
  }

  const { error: paymentError } = await supabase.from('payments').insert({
    gym_id,
    member_id: user.id,
    plan_id,
    amount: price,
    currency: 'NGN',
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

  // Fire-and-forget receipt notifications.
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, first_name, phone, email')
      .eq('id', user.id)
      .maybeSingle();
    const name = profile?.full_name ?? profile?.first_name ?? 'Member';
    await Promise.allSettled([
      sendReceipt(user.email!, { name, amount: price, plan: plan.name ?? 'Membership', endDate: end_date }),
      profile?.phone ? waReceipt(profile.phone, { name, amount: price, endDate: end_date }) : Promise.resolve(),
    ]);
  } catch (e) {
    console.warn('[GF verify] receipt notification failed:', (e as Error).message);
  }

  return NextResponse.json({ success: true, membership, saved_card: savedCard });
}
