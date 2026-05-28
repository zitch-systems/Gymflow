import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { PLATFORM_PRICING, isBillingPeriod } from '@/lib/platform-pricing';
import { rateLimit, rateLimitResponse, clientIpFromRequest, readJsonBody } from '@/lib/rate-limit';

// Owner-initiated GymFlow subscription renewal. Same security shape as the
// member /verify route — verify the Paystack reference server-side, derive
// the price from gyms.subscription_plan (not from the client), then extend
// trial_ends_at + save the card so the daily cron can take it from here.

type Body = { reference?: string; gym_id?: string };

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `platform-renew:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await readJsonBody<Body>(request);
  if (body instanceof Response) return body;
  const { reference, gym_id } = body;
  if (!reference || !gym_id) {
    return NextResponse.json({ error: 'reference and gym_id required' }, { status: 400 });
  }

  // Session auth + owner-of-this-gym check via user-scoped client.
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: link } = await userClient
    .from('gym_staff_links')
    .select('role')
    .eq('user_id', user.id)
    .eq('gym_id', gym_id)
    .eq('role', 'gym_owner')
    .eq('is_active', true)
    .maybeSingle();
  if (!link) return NextResponse.json({ error: 'Not authorized for this gym' }, { status: 403 });

  // Now switch to admin client for the privileged writes (matching the rest
  // of the platform-billing flow: writes to gyms.trial_ends_at and
  // platform_payments are service-role only).
  const admin = createAdminClient();
  const { data: gym } = await admin
    .from('gyms')
    .select('id, slug, email, subscription_plan, trial_ends_at, subscription_status')
    .eq('id', gym_id)
    .maybeSingle();
  if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 });

  const billing = isBillingPeriod(gym.subscription_plan) ? gym.subscription_plan : 'monthly';
  const plan = PLATFORM_PRICING[billing];

  // Verify the charge with Paystack directly — same source-of-truth pattern
  // as the member verify route.
  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try { txn = await verifyTransaction(reference); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 502 }); }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  const txnEmail = (txn.customer?.email ?? '').toLowerCase();
  const userEmail = (user.email ?? '').toLowerCase();
  if (!txnEmail || txnEmail !== userEmail) {
    return NextResponse.json({ error: 'Payment email does not match account' }, { status: 403 });
  }
  if ((txn.currency ?? 'NGN').toUpperCase() !== 'NGN') {
    return NextResponse.json({ error: 'Only NGN payments accepted' }, { status: 400 });
  }
  if (Number(txn.amount) < Math.round(plan.amount * 100)) {
    return NextResponse.json({ error: 'Amount paid is less than the plan price' }, { status: 400 });
  }

  // Idempotency: never double-record the same reference.
  const { data: existing } = await admin
    .from('platform_payments')
    .select('id')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (existing) return NextResponse.json({ success: true, already: true });

  // Extend from whichever is later: today or current period end. Owners who
  // pay early shouldn't lose the remaining days.
  const today = new Date();
  const currentEnd = gym.trial_ends_at ? new Date(gym.trial_ends_at) : today;
  const base = currentEnd > today ? currentEnd : today;
  const newEnd = new Date(base);
  newEnd.setMonth(newEnd.getMonth() + plan.months);

  const { error: gymError } = await admin
    .from('gyms')
    .update({
      subscription_status: 'active',
      trial_ends_at: newEnd.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', gym.id);
  if (gymError) return NextResponse.json({ error: `Gym update failed: ${gymError.message}` }, { status: 500 });

  await admin.from('platform_payments').insert({
    gym_id: gym.id,
    amount: plan.amount,
    payment_status: 'successful',
    paystack_reference: reference,
    billing_period_start: today.toISOString().split('T')[0],
    billing_period_end: newEnd.toISOString().split('T')[0],
  });

  const auth = txn.authorization;
  if (auth?.reusable && auth.authorization_code) {
    await admin.from('saved_cards').upsert(
      {
        gym_id: gym.id,
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
        email: txnEmail,
        is_default: true,
        is_active: true,
      },
      { onConflict: 'member_id,authorization_code' },
    );
  }

  void after; // notification template intentionally omitted — keep this surface tight.

  return NextResponse.json({ success: true, period_end: newEnd.toISOString().split('T')[0] });
}
