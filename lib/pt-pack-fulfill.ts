import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type DB = SupabaseClient<Database>;

export type PtPackFulfilResult =
  | { ok: true; already?: boolean; creditId?: string | null; sessions?: number }
  | { ok: false; status: number; error: string };

export type FulfilPtPack = {
  id: string; gym_id: string; instructor_id: string; name: string; session_count: number; price: number;
};

/**
 * Insert the payments mirror row if it doesn't already exist for this
 * reference. Lets us recover from a prior partial failure where the credit
 * inserted but the payments insert didn't.
 */
async function ensurePaymentMirror(
  supabase: DB,
  args: { pack: FulfilPtPack; memberId: string; reference: string; authorizationCode: string | null; creditId: string | null },
): Promise<void> {
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('paystack_reference', args.reference)
    .maybeSingle();
  if (existing) return;

  // Best-effort insert. A concurrent caller may win the unique constraint
  // race; that's fine — either way a payments row exists after this returns.
  await supabase.from('payments').insert({
    gym_id: args.pack.gym_id,
    member_id: args.memberId,
    amount: Number(args.pack.price),
    currency: 'NGN',
    payment_method: 'card',
    payment_status: 'successful',
    paystack_reference: args.reference,
    paystack_authorization_code: args.authorizationCode ?? null,
    payment_date: new Date().toISOString(),
    metadata: { source: 'pt_pack_purchase', pack_id: args.pack.id, pack_name: args.pack.name, credit_id: args.creditId },
  });
}

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
 * PARTIAL-FAILURE RECOVERY: a previous attempt may have inserted the credit
 * but failed before mirroring to `payments` (network blip, transient DB
 * error, etc.). On a retry we'd return already=true and the wallet would
 * never see the revenue. ensurePaymentMirror() fixes that by checking for
 * the payments row whenever the credit already exists, and writing it if
 * missing.
 */
export async function fulfilPtPackPurchase(
  supabase: DB,
  args: {
    packId: string;
    memberId: string;
    reference: string;
    authorizationCode?: string | null;
    pack?: FulfilPtPack;
  },
): Promise<PtPackFulfilResult> {
  // Resolve the pack early — both the partial-failure-repair path AND the
  // fresh-fulfilment path need its (gym_id, price, name) for the payments row.
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

  // Idempotency: a credit reference is provisioned at most once.
  const { data: existingRaw } = await supabase
    .from('pt_pack_credits' as never)
    .select('id')
    .eq('paystack_reference' as never, args.reference)
    .maybeSingle();
  if (existingRaw) {
    const existingId = (existingRaw as { id: string }).id;
    // Repair: ensure the payments mirror also exists.
    await ensurePaymentMirror(supabase, { pack, memberId: args.memberId, reference: args.reference, authorizationCode: args.authorizationCode ?? null, creditId: existingId });
    return { ok: true, already: true, creditId: existingId };
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
    // Concurrent caller (other of verify/webhook) won the reference race via
    // the unique index. Run the repair so the mirror still lands.
    if (/duplicate key|unique/i.test(creditError.message)) {
      await ensurePaymentMirror(supabase, { pack, memberId: args.memberId, reference: args.reference, authorizationCode: args.authorizationCode ?? null, creditId: null });
      return { ok: true, already: true };
    }
    return { ok: false, status: 500, error: `Credit create failed: ${creditError.message}` };
  }
  const creditId = (creditRaw as { id: string } | null)?.id ?? null;

  // Mirror the purchase into payments so wallet/payouts see the revenue.
  await ensurePaymentMirror(supabase, { pack, memberId: args.memberId, reference: args.reference, authorizationCode: args.authorizationCode ?? null, creditId });

  return { ok: true, creditId, sessions: pack.session_count };
}
