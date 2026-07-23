import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { listTransactions, getTransfer } from '@/lib/paystack';
import { missingLocally, unknownAtPaystack, chunk } from '@/lib/reconcile-core';
import { logAudit } from '@/lib/audit';
import { captureServerEvent } from '@/lib/server-error';

// Daily Paystack ↔ DB reconciliation (called from the cron). Webhooks are the
// primary delivery channel and Paystack retries them, but retries are finite —
// a sustained outage silently drops money events. This sweep is the backstop:
//
//   1. Charges: every successful Paystack charge in the window must exist in
//      payments or platform_payments (by paystack_reference). Misses are
//      audit-logged + sent to Sentry — flagged for a human, NOT auto-fulfilled
//      (routing a stale charge through the wrong fulfillment path unattended
//      is riskier than a superadmin acting on the audit entry).
//   2. Local sanity: recent local rows with a real (non-MANUAL-*) reference
//      should appear in the same Paystack window.
//   3. Stuck payouts: rows in 'approved' whose transfer.success/failed webhook
//      never arrived are resolved by polling the transfer's real status.

type Admin = ReturnType<typeof createAdminClient>;

export type ReconcileSummary = {
  ran: boolean;
  checked: number;
  missingLocally: number;
  unknownAtPaystack: number;
  payoutsResolved: number;
  error?: string;
};

const WINDOW_MS = 48 * 60 * 60 * 1000; // catch anything the last two runs missed
const LOG_CAP = 25; // per-run audit-entry cap so a systemic outage can't flood audit_logs

export async function reconcilePayments(admin: Admin): Promise<ReconcileSummary> {
  const from = new Date(Date.now() - WINDOW_MS);
  const listed = await listTransactions({ from, status: 'success' });
  if (!listed.ok) return { ran: false, checked: 0, missingLocally: 0, unknownAtPaystack: 0, payoutsResolved: 0, error: listed.error };

  const paystackRefs = listed.transactions.map((t) => t.reference);
  const amounts = new Map(listed.transactions.map((t) => [t.reference, t.amountKobo]));

  // Match precisely by reference (chunked .in()) instead of by a parallel time
  // window — local recording time and Paystack paid_at can straddle the edge.
  const localRefs = new Set<string>();
  for (const slice of chunk(paystackRefs, 150)) {
    const [{ data: mem }, { data: plat }] = await Promise.all([
      admin.from('payments').select('paystack_reference').in('paystack_reference', slice),
      admin.from('platform_payments').select('paystack_reference').in('paystack_reference', slice),
    ]);
    for (const r of mem ?? []) if (r.paystack_reference) localRefs.add(r.paystack_reference);
    for (const r of plat ?? []) if (r.paystack_reference) localRefs.add(r.paystack_reference);
  }

  const missing = missingLocally(paystackRefs, localRefs);
  for (const ref of missing.slice(0, LOG_CAP)) {
    void logAudit({
      action: 'reconciliation_missing_payment',
      table: 'payments',
      values: { paystack_reference: ref, amount_kobo: amounts.get(ref) ?? null },
    });
  }
  if (missing.length) {
    void captureServerEvent('reconciliation: Paystack charges missing locally', {
      count: missing.length, sample: missing.slice(0, 10),
    });
  }

  // Direction 2: local rows claiming a Paystack reference the window doesn't
  // know. Query slightly INSIDE the Paystack window so edge-of-window rows
  // can't false-positive. MANUAL-* (cash) rows are excluded in the matcher.
  const localFrom = new Date(from.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const { data: recentLocal } = await admin.from('payments')
    .select('paystack_reference')
    .gte('payment_date', localFrom)
    .not('paystack_reference', 'is', null)
    .limit(1000);
  const unknown = unknownAtPaystack(
    (recentLocal ?? []).map((r) => r.paystack_reference as string),
    new Set(paystackRefs),
  );
  for (const ref of unknown.slice(0, LOG_CAP)) {
    void logAudit({
      action: 'reconciliation_unknown_reference',
      table: 'payments',
      values: { paystack_reference: ref },
    });
  }

  return { ran: true, checked: paystackRefs.length, missingLocally: missing.length, unknownAtPaystack: unknown.length, payoutsResolved: 0 };
}

// Resolve payouts stuck in 'approved' (transfer initiated, confirmation webhook
// never landed). Mirrors lib/transfer-fulfill.ts state transitions exactly:
// success → 'paid'; failed/reversed → back to 'requested' for retry.
export async function reconcilePayouts(admin: Admin): Promise<number> {
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // give the webhook an hour
  const { data: stuck } = await admin.from('instructor_payouts')
    .select('id, gym_id, instructor_id, amount, paystack_transfer_code')
    .eq('status', 'approved')
    .not('paystack_transfer_code', 'is', null)
    .lt('processed_at', staleBefore)
    .limit(20); // bounded — each row costs a Paystack round-trip

  let resolved = 0;
  for (const p of stuck ?? []) {
    const tr = await getTransfer(p.paystack_transfer_code as string);
    if (!tr.ok) continue; // transient — next run retries

    if (tr.status === 'success') {
      const { error } = await admin.from('instructor_payouts')
        .update({ status: 'paid', processed_at: new Date().toISOString(), notes: null })
        .eq('id', p.id).eq('status', 'approved');
      if (!error) {
        resolved++;
        await admin.from('notifications').insert({
          gym_id: p.gym_id, user_id: p.instructor_id, type: 'payment', channel: 'in_app',
          title: 'Payout completed', body: `₦${Number(p.amount).toLocaleString('en-NG')} has landed in your bank account.`,
        });
        void logAudit({
          action: 'payout_reconciled_paid', table: 'instructor_payouts',
          gymId: p.gym_id, recordId: p.id,
          values: { amount: p.amount, transfer_code: p.paystack_transfer_code },
        });
      }
    } else if (tr.status === 'failed' || tr.status === 'reversed') {
      const why = tr.status === 'reversed' ? 'Transfer was reversed by the bank' : `Transfer failed${tr.reason ? `: ${tr.reason}` : ''}`;
      const { error } = await admin.from('instructor_payouts')
        .update({ status: 'requested', paystack_transfer_code: null, notes: why.slice(0, 300) })
        .eq('id', p.id).eq('status', 'approved');
      if (!error) {
        resolved++;
        void logAudit({
          action: 'payout_reconciled_reopened', table: 'instructor_payouts',
          gymId: p.gym_id, recordId: p.id,
          values: { amount: p.amount, reason: why },
        });
      }
    }
    // pending/queued/otp — genuinely still in flight; leave for the webhook.
  }
  return resolved;
}

// Entrypoint for the cron. Never throws; a failed sweep reports itself and the
// next daily run covers the gap (the window is 2× the cadence).
export async function runReconciliation(): Promise<ReconcileSummary> {
  const empty: ReconcileSummary = { ran: false, checked: 0, missingLocally: 0, unknownAtPaystack: 0, payoutsResolved: 0 };
  if (!process.env.PAYSTACK_SECRET_KEY) return empty;
  let admin: Admin;
  try { admin = createAdminClient(); } catch { return empty; }

  try {
    const summary = await reconcilePayments(admin);
    summary.payoutsResolved = await reconcilePayouts(admin);
    return summary;
  } catch (e) {
    const error = (e as Error).message;
    void captureServerEvent('reconciliation sweep failed', { error });
    return { ...empty, error };
  }
}
