import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { fulfilInstructorSubscription } from '@/lib/instructor-sub-fulfill';
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

  // Provision subscription + payments mirror + saved card, idempotent on the
  // reference and shared with the webhook backstop. Security gates above are
  // the route's responsibility; the helper trusts the verified charge.
  const result = await fulfilInstructorSubscription(supabase, {
    gymId: gym_id,
    instructorId: instructor_id,
    memberId: user.id,
    months,
    reference,
    authorization: txn.authorization,
    memberEmail: txn.customer.email,
    pricePerMonth, // reuse the rate already fetched for the amount gate
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.already) {
    return NextResponse.json({ success: true, already: true });
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
        sendReceipt(user.email!, { name, amount: expectedTotal, plan: planName, endDate: result.endDate ?? '' }),
        profile?.phone ? waReceipt(profile.phone, { name, amount: expectedTotal, endDate: result.endDate ?? '' }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF verify-instructor] receipt notification failed:', (e as Error).message);
    }
  });

  return NextResponse.json({ success: true, months });
}
