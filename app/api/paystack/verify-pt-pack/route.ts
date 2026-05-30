import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { sendReceipt } from '@/lib/email';
import { waReceipt } from '@/lib/whatsapp';
import { rateLimit, rateLimitResponse, clientIpFromRequest, readJsonBody } from '@/lib/rate-limit';

// Settles a member-initiated PT-pack purchase. Mirrors /verify-instructor:
// rate-limit → body → session → SERVER-side pack lookup (never trust the
// client's price) → Paystack verify → email/currency/amount gates →
// idempotency on payment_reference → insert pt_pack_credits + payments
// rows under the service-role client → deferred receipt.

type Body = {
  reference?: string;
  pack_id?: string;
};

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `paystack-verify-pt-pack:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await readJsonBody<Body>(request);
  if (body instanceof Response) return body;

  const { reference, pack_id } = body;
  if (!reference || !pack_id) {
    return NextResponse.json({ error: 'reference and pack_id required' }, { status: 400 });
  }

  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Admin client: writes to pt_pack_credits + payments need service-role
  // (both tables are service-role-only for writes).
  const supabase = createAdminClient();

  // Pack lookup — gym/instructor/price/session_count come from THIS row,
  // never from the request body. pt_packs not yet in generated types.
  const { data: packRaw, error: packErr } = await supabase
    .from('pt_packs' as never)
    .select('id, gym_id, instructor_id, name, session_count, price, is_active')
    .eq('id' as never, pack_id)
    .maybeSingle();
  if (packErr || !packRaw) return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
  const pack = packRaw as unknown as { id: string; gym_id: string; instructor_id: string; name: string; session_count: number; price: number; is_active: boolean };
  if (!pack.is_active) return NextResponse.json({ error: 'Pack is no longer available' }, { status: 400 });

  // Cross-gym IDOR guard: the member must belong to the pack's gym.
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('user_id')
    .eq('gym_id', pack.gym_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!link) return NextResponse.json({ error: 'You are not a member of this gym' }, { status: 403 });

  const expectedTotal = Number(pack.price);

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 });
  }
  // Reference-stuffing prevention: the Paystack email must match the session.
  const txnEmail = (txn.customer?.email ?? '').toLowerCase();
  const userEmail = (user.email ?? '').toLowerCase();
  if (!txnEmail || txnEmail !== userEmail) {
    return NextResponse.json({ error: 'Payment email does not match account' }, { status: 403 });
  }
  if ((txn.currency ?? '').toUpperCase() !== 'NGN') {
    return NextResponse.json({ error: 'Only NGN payments accepted' }, { status: 400 });
  }
  if (txn.amount / 100 < expectedTotal) {
    return NextResponse.json({ error: 'Payment amount is less than the pack price' }, { status: 400 });
  }

  // Idempotency on paystack_reference — both pt_pack_credits and payments
  // have at-most-one row per reference. If we've already provisioned this
  // reference, return success without re-inserting.
  const { data: existingCredit } = await supabase
    .from('pt_pack_credits' as never)
    .select('id')
    .eq('paystack_reference' as never, reference)
    .maybeSingle();
  if (existingCredit) {
    return NextResponse.json({ success: true, already: true });
  }

  const { data: creditRaw, error: creditError } = await supabase
    .from('pt_pack_credits' as never)
    .insert({
      gym_id: pack.gym_id,
      member_id: user.id,
      instructor_id: pack.instructor_id,
      pack_id: pack.id,
      sessions_total: pack.session_count,
      sessions_used: 0,
      source: 'paystack',
      paystack_reference: reference,
    } as never)
    .select('id')
    .maybeSingle();
  if (creditError) {
    return NextResponse.json({ error: `Credit create failed: ${creditError.message}` }, { status: 500 });
  }

  // Mirror the purchase in the gym wallet so payouts / wallet analytics
  // see the revenue.
  await supabase.from('payments').insert({
    gym_id: pack.gym_id,
    member_id: user.id,
    amount: expectedTotal,
    currency: 'NGN',
    payment_method: 'card',
    payment_status: 'successful',
    paystack_reference: reference,
    paystack_authorization_code: txn.authorization?.authorization_code ?? null,
    payment_date: new Date().toISOString(),
    metadata: { source: 'pt_pack_purchase', pack_id: pack.id, pack_name: pack.name, credit_id: (creditRaw as { id: string } | null)?.id ?? null },
  });

  // Defer receipts so a slow Resend/WhatsApp doesn't extend the response.
  after(async () => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, first_name, phone')
        .eq('id', user.id)
        .maybeSingle();
      const name = profile?.full_name ?? profile?.first_name ?? 'Member';
      // PT packs don't expire by default → use the today date as the "end".
      const endDate = new Date().toISOString().split('T')[0];
      await Promise.allSettled([
        sendReceipt(user.email!, { name, amount: expectedTotal, plan: pack.name, endDate }),
        profile?.phone ? waReceipt(profile.phone, { name, amount: expectedTotal, endDate }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF verify-pt-pack] receipt failed:', (e as Error).message);
    }
  });

  return NextResponse.json({ success: true, sessions: pack.session_count });
}
