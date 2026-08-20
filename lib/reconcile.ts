import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { listTransactions, getTransfer, getSubaccount, updateSubaccountCommission } from '@/lib/paystack';
import { missingLocally, unknownAtPaystack, chunk, planGymSplitFix, type SubaccountLookupStatus } from '@/lib/reconcile-core';
import { ensureSubaccount, syncGymFromActive, type PayoutAccount } from '@/lib/payout-sync';
import { logAudit } from '@/lib/audit';
import { alertGymPayoutChanged } from '@/lib/payout-alerts';
import { captureServerEvent } from '@/lib/server-error';
import { fmtDate } from '@/lib/format';
import type { EmailContent } from '@/lib/email';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { getContact, type EmailContact } from '@/lib/email/recipients';
import { payoutCompleted, payoutFailed } from '@/lib/email/templates/platform';

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
//   4. Gym splits: a gym's stored paystack_subaccount_code can stop resolving
//      at Paystack (created under a different key/mode, or deleted there), or
//      its live percentage_charge can drift from platform_commission_pct
//      (setGymCommission writes the DB first and pushes to Paystack second, by
//      design — see that function — so a Paystack rejection leaves the two out
//      of sync). Checked gyms are flagged (or cleared) via
//      gyms.paystack_sync_error / paystack_sync_checked_at. Gyms on a FIXED
//      commission are swept identically — their percentage is still the live
//      fallback on the subaccount, so it is still the thing to keep in sync.
//      See planGymSplitFix for why this needs no mode awareness.

type Admin = ReturnType<typeof createAdminClient>;

export type ReconcileSummary = {
  ran: boolean;
  checked: number;
  missingLocally: number;
  unknownAtPaystack: number;
  payoutsResolved: number;
  gymSplitsFixed: number;
  error?: string;
};

const WINDOW_MS = 48 * 60 * 60 * 1000; // catch anything the last two runs missed
const LOG_CAP = 25; // per-run audit-entry cap so a systemic outage can't flood audit_logs
const GYM_SPLIT_RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // revisit every subaccount gym at least weekly
const GYM_SPLIT_CAP = 25; // bounded — each candidate costs a Paystack round-trip, shares the cron's 60s budget

export async function reconcilePayments(admin: Admin): Promise<ReconcileSummary> {
  const from = new Date(Date.now() - WINDOW_MS);
  const listed = await listTransactions({ from, status: 'success' });
  if (!listed.ok) return { ran: false, checked: 0, missingLocally: 0, unknownAtPaystack: 0, payoutsResolved: 0, gymSplitsFixed: 0, error: listed.error };

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

  return { ran: true, checked: paystackRefs.length, missingLocally: missing.length, unknownAtPaystack: unknown.length, payoutsResolved: 0, gymSplitsFixed: 0 };
}

type StuckPayout = {
  id: string;
  gym_id: string;
  instructor_id: string;
  amount: number;
  paystack_transfer_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  /** Embedded via instructor_payouts.gym_id → gyms. */
  gyms: { name: string | null } | null;
};

// Same shape and same reasoning as lib/transfer-fulfill.ts: this sweep sends the
// mail the missing webhook would have sent, so an email failure must leave the
// row resolved and the run counted rather than throwing out of the cron.
async function mailInstructor(
  admin: Admin,
  instructorId: string,
  build: (instructor: EmailContact) => EmailContent,
  template: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const instructor = await getContact(admin, instructorId);
    if (!instructor?.email) return;
    await sendPlatformEmail({ to: instructor.email, ...build(instructor), template });
  } catch { /* the in-app row is the system of record */ }
}

// Resolve payouts stuck in 'approved' (transfer initiated, confirmation webhook
// never landed). Mirrors lib/transfer-fulfill.ts state transitions exactly:
// success → 'paid'; failed/reversed → back to 'requested' for retry.
export async function reconcilePayouts(admin: Admin): Promise<number> {
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // give the webhook an hour
  const { data: stuck } = await admin.from('instructor_payouts')
    // Bank snapshot + gym name ride along for the same emails transfer-fulfill
    // sends; nothing else here would need them.
    .select('id, gym_id, instructor_id, amount, paystack_transfer_code, bank_name, account_number, gyms(name)')
    .eq('status', 'approved')
    .not('paystack_transfer_code', 'is', null)
    .lt('processed_at', staleBefore)
    .limit(20); // bounded — each row costs a Paystack round-trip

  let resolved = 0;
  for (const p of (stuck ?? []) as StuckPayout[]) {
    const tr = await getTransfer(p.paystack_transfer_code as string);
    if (!tr.ok) continue; // transient — next run retries

    if (tr.status === 'success') {
      // .select() so we can tell "I made this transition" from "it was already
      // made". An update matching zero rows still returns error:null, so
      // checking only `!error` would re-notify when the webhook settled this
      // payout between our select above and this update — the instructor would
      // hear their money arrived twice.
      const { data: moved, error } = await admin.from('instructor_payouts')
        .update({ status: 'paid', processed_at: new Date().toISOString(), notes: null })
        .eq('id', p.id).eq('status', 'approved')
        .select('id');
      if (!error && moved && moved.length > 0) {
        resolved++;
        await admin.from('notifications').insert({
          gym_id: p.gym_id, user_id: p.instructor_id, type: 'payment', channel: 'in_app',
          title: 'Payout completed', body: `₦${Number(p.amount).toLocaleString('en-NG')} has landed in your bank account.`,
        });
        await mailInstructor(admin, p.instructor_id, (instructor) => payoutCompleted({
          instructorName: instructor.fullName,
          gymName: p.gyms?.name ?? 'your gym',
          amountNaira: Number(p.amount),
          bankName: p.bank_name,
          last4: (p.account_number ?? '').slice(-4),
          paidDate: fmtDate(new Date().toISOString()),
          reference: p.paystack_transfer_code,
          earningsUrl: platformAppUrl('/coach/earnings'),
        }), 'payout_completed');
        void logAudit({
          action: 'payout_reconciled_paid', table: 'instructor_payouts',
          gymId: p.gym_id, recordId: p.id,
          values: { amount: p.amount, transfer_code: p.paystack_transfer_code },
        });
      }
    } else if (tr.status === 'failed' || tr.status === 'reversed') {
      const why = tr.status === 'reversed' ? 'Transfer was reversed by the bank' : `Transfer failed${tr.reason ? `: ${tr.reason}` : ''}`;
      // Same rows-affected check as the success branch, for the same race.
      const { data: moved, error } = await admin.from('instructor_payouts')
        .update({ status: 'requested', paystack_transfer_code: null, notes: why.slice(0, 300) })
        .eq('id', p.id).eq('status', 'approved')
        .select('id');
      if (!error && moved && moved.length > 0) {
        resolved++;
        // The reopened path wrote only an audit entry: an instructor whose
        // transfer bounced saw nothing at all in the app while the money sat
        // back in the gym's balance. Same row the webhook path writes.
        await admin.from('notifications').insert({
          gym_id: p.gym_id, user_id: p.instructor_id, type: 'warning', channel: 'in_app',
          title: 'Payout delayed', body: `Your ₦${Number(p.amount).toLocaleString('en-NG')} payout hit a snag (${why.toLowerCase()}). The gym will retry it.`,
        });
        await mailInstructor(admin, p.instructor_id, (instructor) => payoutFailed({
          instructorName: instructor.fullName,
          gymName: p.gyms?.name ?? 'your gym',
          amountNaira: Number(p.amount),
          reason: why,
          bankName: p.bank_name,
          last4: (p.account_number ?? '').slice(-4),
          payoutSettingsUrl: platformAppUrl('/coach/payouts'),
        }), 'payout_failed');
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

type GymSplitCandidate = {
  id: string;
  name: string | null;
  paystack_subaccount_code: string | null;
  platform_commission_pct: number | string | null;
};

// Gyms whose Paystack split needs (re)checking this run: ones a previous push
// already flagged as failing, plus — oldest-checked first — any gym with a
// subaccount that hasn't been verified in a week. The second half is what
// catches a gym that went stale silently, with no commission edit ever
// re-triggering the push that would have flagged it.
async function gymSplitCandidates(admin: Admin): Promise<GymSplitCandidate[]> {
  const staleBefore = new Date(Date.now() - GYM_SPLIT_RECHECK_MS).toISOString();
  const { data } = await admin.from('gyms')
    .select('id, name, paystack_subaccount_code, platform_commission_pct')
    .not('paystack_subaccount_code', 'is', null)
    .or(`paystack_sync_error.not.is.null,paystack_sync_checked_at.is.null,paystack_sync_checked_at.lt.${staleBefore}`)
    .order('paystack_sync_checked_at', { ascending: true, nullsFirst: true })
    .limit(GYM_SPLIT_CAP);
  return (data ?? []) as unknown as GymSplitCandidate[];
}

// `expectedPct`, when given, guards this write the same way reconcilePayouts
// guards its own state transitions with `.eq('status','approved')`: it only
// applies if platform_commission_pct still matches the value this run last
// acted on. Pass it whenever the write is declaring "this gym is in sync" —
// if a human edit (setGymCommission) landed a new rate in the gap between our
// read and this write, that declaration would be stale, so the row-affected
// check quietly no-ops instead of certifying a rate we didn't verify.
// Omit it for failure writes, where recording the error is correct regardless
// of a concurrent rate change.
async function markGymSplitChecked(admin: Admin, gymId: string, error: string | null, expectedPct?: number): Promise<void> {
  let q = admin.from('gyms').update({
    paystack_sync_error: error,
    paystack_sync_checked_at: new Date().toISOString(),
  } as never).eq('id', gymId);
  if (expectedPct != null) q = q.eq('platform_commission_pct', expectedPct);
  await q;
}

// Recreate a gym's subaccount when the stored code no longer resolves at
// Paystack, reusing the exact create step lib/actions/payout-accounts.ts uses
// (lib/payout-sync.ts) rather than a second implementation. `staleCode` guards
// a race: if the active payout account's code has already moved off it since
// this run looked it up — a concurrent sweep, or a human re-editing payouts —
// this uses whatever is there now instead of creating a second subaccount.
async function recreateGymSubaccount(
  admin: Admin, gymId: string, gymName: string, staleCode: string, dbPct: number,
): Promise<{ ok: true; subaccountCode: string } | { ok: false; error: string }> {
  const { data } = await admin.from('gym_payout_accounts' as never)
    .select('id, gym_id, bank_name, bank_code, account_number, account_name, verified, is_active, paystack_subaccount_code')
    .eq('gym_id', gymId).eq('is_active', true).maybeSingle();
  const account = data as unknown as PayoutAccount | null;
  if (!account) return { ok: false, error: 'No active payout account on file to recreate the subaccount from.' };

  // Only actually mints a new subaccount when the active account's code still
  // matches what this run started from — see ensureSubaccount's `force` doc.
  const force = account.paystack_subaccount_code === staleCode;
  const created = await ensureSubaccount(admin, account, gymName, dbPct, { force });
  if (!created.ok) return created;

  await syncGymFromActive(admin, gymId);

  // A genuine mint repoints where this gym's real member payments settle —
  // the same class of change lib/actions/payout-accounts.ts always audits and
  // alerts the owner about (see alertGymPayoutChanged's header comment: this
  // is the second line of defense against a hijacked session that survives
  // re-auth). `force` false means ensureSubaccount short-circuited on a code a
  // human already changed underneath this run — nothing was actually touched,
  // so nothing to log or alert about.
  if (force) {
    void logAudit({
      action: 'gym_subaccount_recreated',
      table: 'gyms',
      gymId,
      recordId: gymId,
      values: { from: staleCode, to: created.subaccountCode, reason: 'stored subaccount code stopped resolving at Paystack (404)' },
    });
    await alertGymPayoutChanged({
      gymId, gymName, action: 'recreated',
      bankName: account.bank_name, last4: account.account_number.slice(-4),
      actorId: null, // automated — see alertGymPayoutChanged's null-actorId branch
    });
  }

  return created;
}

// For each candidate gym, check the stored subaccount code against Paystack
// and fix whatever's wrong: recreate a missing/invalid subaccount, or push the
// DB's commission % when only that has drifted. A gym that already matches
// costs one Paystack GET and a checked_at stamp — no writes to Paystack.
// Idempotent per gym: nothing here runs unless a mismatch was just observed,
// so a gym already in sync is a fast no-op on every call.
export async function reconcileGymSplits(admin: Admin): Promise<number> {
  const candidates = await gymSplitCandidates(admin);
  let fixed = 0;

  for (const gym of candidates) {
    const code = gym.paystack_subaccount_code;
    if (!code) continue; // guarded by the query; keeps this loop self-contained

    const lookup = await getSubaccount(code);

    // Re-read the commission rate immediately before deciding/acting on it,
    // rather than trusting the batch snapshot from gymSplitCandidates. That
    // snapshot can be many candidates (and Paystack round-trips) stale by the
    // time the serial loop reaches this gym — long enough for a concurrent
    // setGymCommission edit to have written a new rate AND pushed it live in
    // between. Planning off the fresh value here means an already-corrected
    // rate reads as 'noop' instead of a "mismatch" this sweep would otherwise
    // revert back to the old number.
    const { data: freshRow } = await admin.from('gyms').select('platform_commission_pct').eq('id', gym.id).maybeSingle();
    const dbPct = Number((freshRow as { platform_commission_pct: number | string | null } | null)?.platform_commission_pct ?? gym.platform_commission_pct ?? 0);

    const subaccountStatus: SubaccountLookupStatus = lookup.ok ? 'found' : (lookup.status === 404 ? 'not_found' : 'lookup_failed');
    const plan = planGymSplitFix({ subaccountStatus, livePct: lookup.ok ? lookup.data.percentageCharge : null, dbPct });

    if (plan === 'retry_later') {
      // Not evidence the subaccount is gone — this one GET failed (timeout,
      // dropped connection, 401/429/5xx, bad JSON). Record why and leave the
      // gym for the next run instead of minting a duplicate subaccount off a
      // transient hiccup — see planGymSplitFix's doc.
      await markGymSplitChecked(admin, gym.id, lookup.ok ? null : lookup.error);
      continue;
    }

    if (plan === 'noop') {
      await markGymSplitChecked(admin, gym.id, null, dbPct);
      continue;
    }

    if (plan === 'recreate') {
      const created = await recreateGymSubaccount(admin, gym.id, gym.name ?? 'Gym', code, dbPct);
      if (!created.ok) { await markGymSplitChecked(admin, gym.id, created.error); continue; }
      // A freshly created subaccount is created WITH dbPct already, but push
      // it explicitly too — this path should end no less in-sync than the
      // ordinary commission-edit flow's own push, and it's a harmless no-op
      // at Paystack if the percentage already matches.
      const push = await updateSubaccountCommission(created.subaccountCode, dbPct);
      if (!push.ok) { await markGymSplitChecked(admin, gym.id, push.error); continue; }
      fixed++;
      await markGymSplitChecked(admin, gym.id, null, dbPct);
      continue;
    }

    // plan === 'push_commission': the subaccount resolves, only the rate drifted.
    const push = await updateSubaccountCommission(code, dbPct);
    if (!push.ok) { await markGymSplitChecked(admin, gym.id, push.error); continue; }
    fixed++;
    await markGymSplitChecked(admin, gym.id, null, dbPct);
  }

  return fixed;
}

// Entrypoint for the cron. Never throws; a failed sweep reports itself and the
// next daily run covers the gap (the window is 2× the cadence).
export async function runReconciliation(): Promise<ReconcileSummary> {
  const empty: ReconcileSummary = { ran: false, checked: 0, missingLocally: 0, unknownAtPaystack: 0, payoutsResolved: 0, gymSplitsFixed: 0 };
  if (!process.env.PAYSTACK_SECRET_KEY) return empty;
  let admin: Admin;
  try { admin = createAdminClient(); } catch { return empty; }

  try {
    const summary = await reconcilePayments(admin);
    summary.payoutsResolved = await reconcilePayouts(admin);
    summary.gymSplitsFixed = await reconcileGymSplits(admin);
    return summary;
  } catch (e) {
    const error = (e as Error).message;
    void captureServerEvent('reconciliation sweep failed', { error });
    return { ...empty, error };
  }
}
