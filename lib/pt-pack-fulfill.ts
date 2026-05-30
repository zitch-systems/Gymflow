import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type DB = SupabaseClient<Database>;

export type PtPackFulfilResult =
  | { ok: true; already?: boolean; creditId?: string | null; sessions?: number }
  | { ok: false; status: number; error: string };

/**
 * Provision a PT-pack credit for a successful Paystack charge. The pack row is
 * the single source of truth for gym, instructor, price, and session count —
 * the client/webhook payload is never trusted for money.
 *
 * Idempotent on the payment reference (pt_pack_credits.paystack_reference), so
 * it is safe to call from BOTH the browser /verify-pt-pack path and the
 * server-to-server webhook: whichever arrives first creates the credit, the
 * other no-ops.
 *
 * Note: caller is responsible for the cross-gym IDOR check (member belongs to
 * the pack's gym) and the Paystack amount/currency/email verification. This
 * helper only does the lookup-and-insert, with idempotency.
 */
export type FulfilPtPack = {
  id: string; gym_id: string; instructor_id: string; name: string; session_count: number; price: number;
};

export async function fulfilPtPackPurchase(
  supabase: DB,
  args: {
    packId: string;
    memberId: string;
    reference: string;
    authorizationCode?: string | null;
    // The verify route already fetched + verified the pack; pass it to avoid a
    // second round-trip. The webhook doesn't pre-fetch, so it's omitted there
    // and the helper looks the pack up itself.
    pack?: FulfilPtPack;
  },
): Promise<PtPackFulfilResult> {
  // Idempotency: a reference is provisioned at most once.
  const { data: existing } = await supabase
    .from('pt_pack_credits' as never)
    .select('id')
    .eq('paystack_reference' as never, args.reference)
    .maybeSingle();
  if (existing) return { ok: true, already: true, creditId: (existing as { id: string }).id };

  // Pack is the source of truth for instructor + session_count + price.
  let pack = args.pack;
  if (!pack) {
    const { data: packRaw, error: packErr } = await supabase
      .from('pt_packs' as never)
      .select('id, gym_id, instructor_id, name, session_count, price, is_active')
      .eq('id' as never, args.packId)
      .maybeSingle();
    if (packErr || !packRaw) return { ok: false, status: 404, error: 'Pack not found' };
    pack = packRaw as unknown as FulfilPtPack;
  }

  const { data: creditRaw, error: creditError } = await supabase
    .from('pt_pack_credits' as never)
    .insert({
      gym_id: pack.gym_id,
      member_id: args.memberId,
      instructor_id: pack.instructor_id,
      pack_id: pack.id,
      sessions_total: pack.session_count,
      sessions_used: 0,
      source: 'paystack',
      paystack_reference: args.reference,
    } as never)
    .select('id')
    .maybeSingle();
  if (creditError) {
    // Most likely a concurrent caller (the other of verify/webhook) won the
    // reference race via the unique index. Treat as idempotent success.
    if (/duplicate key|unique/i.test(creditError.message)) {
      return { ok: true, already: true };
    }
    return { ok: false, status: 500, error: `Credit create failed: ${creditError.message}` };
  }
  const creditId = (creditRaw as { id: string } | null)?.id ?? null;

  // Mirror the purchase into payments so wallet/payouts see the revenue.
  await supabase.from('payments').insert({
    gym_id: pack.gym_id,
    member_id: args.memberId,
    amount: Number(pack.price),
    currency: 'NGN',
    payment_method: 'card',
    payment_status: 'successful',
    paystack_reference: args.reference,
    paystack_authorization_code: args.authorizationCode ?? null,
    payment_date: new Date().toISOString(),
    metadata: { source: 'pt_pack_purchase', pack_id: pack.id, pack_name: pack.name, credit_id: creditId },
  });

  return { ok: true, creditId, sessions: pack.session_count };
}
