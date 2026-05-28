import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { fulfilMembershipPurchase } from '@/lib/paystack-fulfill';
import { rateLimit, rateLimitResponse, clientIpFromRequest } from '@/lib/rate-limit';

type VerifyBody = {
  reference?: string;
  plan_id?: string;
  payment_method?: string;
};

export async function POST(request: Request) {
  // Verify is idempotent on reference, but a flood of bogus references still
  // costs Paystack API calls; cap per IP.
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `paystack-verify:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

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

  // Authorization is complete (session verified, Paystack charge verified, email
  // matched). The privileged writes (memberships/payments/saved_cards have no
  // authenticated-role INSERT policy by design) go through the service-role
  // client — same path the webhook uses.
  const admin = createAdminClient();
  const result = await fulfilMembershipPurchase(
    admin,
    user.id,
    plan_id,
    {
      reference,
      amountKobo: Number(txn.amount),
      currency: txn.currency,
      customerEmail: txn.customer.email,
      authorization: txn.authorization,
    },
    { paymentMethod: payment_method, notify: true },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, already: result.already ?? false });
}
