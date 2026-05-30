import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { sendReceipt } from '@/lib/email';
import { waReceipt } from '@/lib/whatsapp';
import { rateLimit, rateLimitResponse, clientIpFromRequest, readJsonBody } from '@/lib/rate-limit';

type Body = {
  reference?: string;
  gym_id?: string;
  instructor_id?: string;
  months?: number;
};

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `paystack-verify-instructor:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await readJsonBody<Body>(request);
  if (body instanceof Response) return body;

  const { reference, gym_id, instructor_id, months } = body;
  if (!reference || !gym_id || !instructor_id || !months || months < 1 || months > 24) {
    return NextResponse.json({ error: 'reference, gym_id, instructor_id, months required' }, { status: 400 });
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Authorized (session verified, Paystack charge verified below). payments has
  // no authenticated-role INSERT policy, so the writes use the service-role
  // client — same pattern as the membership verify route and the webhook.
  const supabase = createAdminClient();

  // Look up the instructor's price server-side — never trust the client.
  const { data: pricing, error: pricingError } = await supabase
    .from('instructor_pricing')
    .select('price')
    .eq('gym_id', gym_id)
    .eq('instructor_id', instructor_id)
    .eq('is_active', true)
    .eq('billing_period', 'monthly')
    .maybeSingle();

  if (pricingError || !pricing) {
    return NextResponse.json({ error: 'Instructor pricing not found' }, { status: 404 });
  }

  const pricePerMonth = Number(pricing.price);
  const expectedTotal = pricePerMonth * months;

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  // Case-fold both sides — both providers normally lowercase, but defence in depth.
  const txnEmail = (txn.customer?.email ?? '').toLowerCase();
  const userEmail = (user.email ?? '').toLowerCase();
  if (!txnEmail || txnEmail !== userEmail) {
    return NextResponse.json({ error: 'Email on payment does not match account' }, { status: 403 });
  }
  if ((txn.currency ?? '').toUpperCase() !== 'NGN') {
    return NextResponse.json({ error: 'Only NGN payments accepted' }, { status: 400 });
  }
  if (txn.amount / 100 < expectedTotal) {
    return NextResponse.json({ error: 'Payment amount is less than the required price' }, { status: 400 });
  }

  // Idempotency: if we've already recorded this reference, return success —
  // but first repair the payments mirror if a previous partial failure left
  // the subscription without one. Without this check, a transient failure
  // mid-fulfilment would leave the wallet permanently missing the revenue.
  const { data: existing } = await supabase
    .from('instructor_subscriptions')
    .select('id')
    .eq('payment_reference', reference)
    .maybeSingle();
  if (existing) {
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (!existingPayment) {
      await supabase.from('payments').insert({
        gym_id,
        member_id: user.id,
        amount: expectedTotal,
        currency: 'NGN',
        payment_method: 'card',
        payment_status: 'successful',
        paystack_reference: reference,
        paystack_authorization_code: txn.authorization?.authorization_code ?? null,
        payment_date: new Date().toISOString(),
      });
    }
    return NextResponse.json({ success: true, subscription: existing, already: true });
  }

  // Compute dates server-side.
  const today = new Date().toISOString().split('T')[0];
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + months);
  const end_date = endDateObj.toISOString().split('T')[0];

  const { data: subscription, error: subError } = await supabase
    .from('instructor_subscriptions')
    .insert({
      gym_id,
      instructor_id,
      member_id: user.id,
      status: 'active',
      start_date: today,
      end_date,
      amount_paid: expectedTotal,
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
    amount: expectedTotal,
    currency: 'NGN',
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

  // Defer receipts to after the response so slow email/WhatsApp providers
  // can't stretch the user's wait time.
  after(async () => {
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
      await Promise.allSettled([
        sendReceipt(user.email!, { name, amount: expectedTotal, plan: planName, endDate: end_date }),
        profile?.phone ? waReceipt(profile.phone, { name, amount: expectedTotal, endDate: end_date }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF verify-instructor] receipt notification failed:', (e as Error).message);
    }
  });

  return NextResponse.json({ success: true, subscription, months });
}
