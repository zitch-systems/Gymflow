import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

// Paystack transfer webhook handling for instructor payouts. Completes the
// async half of lib/actions/payouts.ts payPayout():
//
//   transfer.success  → status 'paid'
//   transfer.failed   → back to 'requested' with a note, so staff can retry
//   transfer.reversed → back to 'requested' (the money came back)
//
// Rows are matched by paystack_transfer_code (stored at initiation), with the
// reference `payout-<uuid>-<nonce>` as fallback for the tiny window where the
// transfer was initiated but the code write failed.

type Json = Record<string, unknown>;
export type TransferResult = { ok: boolean; error?: string; permanent?: boolean };

const TRANSFER_EVENTS = new Set(['transfer.success', 'transfer.failed', 'transfer.reversed']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

export function isTransferEvent(event: Json): boolean {
  return TRANSFER_EVENTS.has(str(event.event) ?? '');
}

export async function handleTransferEvent(event: Json): Promise<TransferResult> {
  const name = str(event.event) ?? '';
  const data = (event.data as Json) ?? {};
  const transferCode = str(data.transfer_code);
  const reference = str(data.reference);

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Locate the payout row.
  let payout: { id: string; gym_id: string; instructor_id: string; amount: number; status: string } | null = null;
  if (transferCode) {
    const { data: hit } = await admin.from('instructor_payouts')
      .select('id, gym_id, instructor_id, amount, status')
      .eq('paystack_transfer_code', transferCode).maybeSingle();
    payout = hit;
  }
  if (!payout && reference?.startsWith('payout-')) {
    const id = reference.slice('payout-'.length).split('-').slice(0, 5).join('-');
    const { data: hit } = await admin.from('instructor_payouts')
      .select('id, gym_id, instructor_id, amount, status')
      .eq('id', id).maybeSingle();
    payout = hit;
  }
  if (!payout) {
    // Not one of ours (e.g. a manual dashboard transfer) — ack so Paystack
    // stops resending; nothing to update.
    console.warn(`[transfer] no payout row for ${name} (${transferCode ?? reference ?? 'no id'})`);
    return { ok: true };
  }

  if (name === 'transfer.success') {
    // Idempotent: setting 'paid' twice is a no-op.
    const { error } = await admin.from('instructor_payouts')
      .update({ status: 'paid', processed_at: new Date().toISOString(), notes: null })
      .eq('id', payout.id);
    if (error) return { ok: false, error: error.message };
    await admin.from('notifications').insert({
      gym_id: payout.gym_id, user_id: payout.instructor_id, type: 'payment', channel: 'in_app',
      title: 'Payout completed', body: `₦${Number(payout.amount).toLocaleString('en-NG')} has landed in your bank account.`,
    });
  } else {
    // failed / reversed → reopen for retry. Clear the transfer code so the
    // next payPayout initiates a fresh transfer (with a fresh reference).
    const why = name === 'transfer.reversed' ? 'Transfer was reversed by the bank' : `Transfer failed${str(data.reason) ? `: ${str(data.reason)}` : ''}`;
    const { error } = await admin.from('instructor_payouts')
      .update({ status: 'requested', paystack_transfer_code: null, notes: why.slice(0, 300) })
      .eq('id', payout.id);
    if (error) return { ok: false, error: error.message };
    await admin.from('notifications').insert({
      gym_id: payout.gym_id, user_id: payout.instructor_id, type: 'warning', channel: 'in_app',
      title: 'Payout delayed', body: `Your ₦${Number(payout.amount).toLocaleString('en-NG')} payout hit a snag (${why.toLowerCase()}). The gym will retry it.`,
    });
  }

  void logAudit({
    action: name.replace('.', '_'), table: 'instructor_payouts',
    gymId: payout.gym_id, recordId: payout.id,
    values: { amount: payout.amount, instructor_id: payout.instructor_id, transfer_code: transferCode },
  });
  return { ok: true };
}
