import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { fulfilPtPackPurchase } from '@/lib/pt-pack-fulfill';
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

  // Provision the credit (+ mirror to payments), idempotent on reference.
  // Shared with the webhook backstop so a closed-tab purchase still settles.
  const result = await fulfilPtPackPurchase(supabase, {
    packId: pack.id,
    memberId: user.id,
    reference,
    authorizationCode: txn.authorization?.authorization_code ?? null,
    // Reuse the pack we already fetched + verified above (no second query).
    pack: { id: pack.id, gym_id: pack.gym_id, instructor_id: pack.instructor_id, name: pack.name, session_count: pack.session_count, price: pack.price },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.already) {
    return NextResponse.json({ success: true, already: true });
  }

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
