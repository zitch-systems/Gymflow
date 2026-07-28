import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { fmtDate } from '@/lib/format';
import type { EmailContent } from '@/lib/email';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { getContact, type EmailContact } from '@/lib/email/recipients';
import { payoutCompleted, payoutFailed } from '@/lib/email/templates/platform';

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

type PayoutRow = {
  id: string;
  gym_id: string;
  instructor_id: string;
  amount: number;
  status: string;
  bank_name: string | null;
  account_number: string | null;
  /** Embedded via instructor_payouts.gym_id → gyms. */
  gyms: { name: string | null } | null;
};

const TRANSFER_EVENTS = new Set(['transfer.success', 'transfer.failed', 'transfer.reversed']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

export function isTransferEvent(event: Json): boolean {
  return TRANSFER_EVENTS.has(str(event.event) ?? '');
}

// Locate the payout this event is about, by transfer code first and the
// `payout-<uuid>-<nonce>` reference second. The select carries the bank
// snapshot and the gym's name because the emails need both and neither is on
// the event — "your payout failed" that names neither the gym nor the account
// is unactionable.
async function findPayout(
  admin: ReturnType<typeof createAdminClient>,
  transferCode: string | null,
  reference: string | null,
): Promise<PayoutRow | null> {
  const columns = 'id, gym_id, instructor_id, amount, status, bank_name, account_number, gyms(name)';
  if (transferCode) {
    const { data } = await admin.from('instructor_payouts')
      .select(columns).eq('paystack_transfer_code', transferCode).maybeSingle();
    if (data) return data as PayoutRow;
  }
  if (reference?.startsWith('payout-')) {
    const id = reference.slice('payout-'.length).split('-').slice(0, 5).join('-');
    const { data } = await admin.from('instructor_payouts')
      .select(columns).eq('id', id).maybeSingle();
    if (data) return data as PayoutRow;
  }
  return null;
}

// Both branches below mail the same person about the same row, and neither may
// fail the webhook: Paystack retries a non-2xx, and a retry would re-run the
// state transition for a message that simply didn't send.
async function mailInstructor(
  admin: ReturnType<typeof createAdminClient>,
  instructorId: string,
  build: (instructor: EmailContact) => EmailContent,
  template: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const instructor = await getContact(admin, instructorId);
    if (!instructor?.email) return;
    await sendPlatformEmail({ to: instructor.email, ...build(instructor), template });
  } catch { /* the in-app row above is the system of record */ }
}

export async function handleTransferEvent(event: Json): Promise<TransferResult> {
  const name = str(event.event) ?? '';
  const data = (event.data as Json) ?? {};
  const transferCode = str(data.transfer_code);
  const reference = str(data.reference);

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // const, not a reassigned let: the null check below has to narrow inside the
  // email closures too.
  const payout = await findPayout(admin, transferCode, reference);
  if (!payout) {
    // Not one of ours (e.g. a manual dashboard transfer) — ack so Paystack
    // stops resending; nothing to update.
    console.warn(`[transfer] no payout row for ${name} (${transferCode ?? reference ?? 'no id'})`);
    return { ok: true };
  }

  if (name === 'transfer.success') {
    // The transition IS the lock. Guarding on the prior status and asking for
    // the changed rows back means exactly one writer can move a payout to
    // 'paid' — this handler or lib/reconcile.ts, whichever gets there first.
    // Without it a webhook delivered late (Paystack retry, or our own earlier
    // 500) lands after reconcile has already settled the row, updates paid→paid
    // "successfully", and mails the instructor a second "payout completed".
    // Setting the row twice is harmless; telling someone their money arrived
    // twice is not.
    const { data: moved, error } = await admin.from('instructor_payouts')
      .update({ status: 'paid', processed_at: new Date().toISOString(), notes: null })
      .eq('id', payout.id)
      .neq('status', 'paid')
      .select('id');
    if (error) return { ok: false, error: error.message };
    // Someone else already settled it — ack the webhook, send nothing.
    if (!moved || moved.length === 0) return { ok: true };
    await admin.from('notifications').insert({
      gym_id: payout.gym_id, user_id: payout.instructor_id, type: 'payment', channel: 'in_app',
      title: 'Payout completed', body: `₦${Number(payout.amount).toLocaleString('en-NG')} has landed in your bank account.`,
    });
    await mailInstructor(admin, payout.instructor_id, (instructor) => payoutCompleted({
      instructorName: instructor.fullName,
      gymName: payout.gyms?.name ?? 'your gym',
      amountNaira: Number(payout.amount),
      bankName: payout.bank_name,
      last4: (payout.account_number ?? '').slice(-4),
      paidDate: fmtDate(new Date().toISOString()),
      reference,
      earningsUrl: platformAppUrl('/coach/earnings'),
    }), 'payout_completed');
  } else {
    // failed / reversed → reopen for retry. Clear the transfer code so the
    // next payPayout initiates a fresh transfer (with a fresh reference).
    const why = name === 'transfer.reversed' ? 'Transfer was reversed by the bank' : `Transfer failed${str(data.reason) ? `: ${str(data.reason)}` : ''}`;
    // Same single-writer guard as the success branch: only the transition out
    // of the in-flight state notifies. A duplicate delivery finds the payout
    // already reopened and stays quiet.
    const { data: moved, error } = await admin.from('instructor_payouts')
      .update({ status: 'requested', paystack_transfer_code: null, notes: why.slice(0, 300) })
      .eq('id', payout.id)
      .neq('status', 'requested')
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!moved || moved.length === 0) return { ok: true };
    await admin.from('notifications').insert({
      gym_id: payout.gym_id, user_id: payout.instructor_id, type: 'warning', channel: 'in_app',
      title: 'Payout delayed', body: `Your ₦${Number(payout.amount).toLocaleString('en-NG')} payout hit a snag (${why.toLowerCase()}). The gym will retry it.`,
    });
    await mailInstructor(admin, payout.instructor_id, (instructor) => payoutFailed({
      instructorName: instructor.fullName,
      gymName: payout.gyms?.name ?? 'your gym',
      amountNaira: Number(payout.amount),
      reason: why,
      bankName: payout.bank_name,
      last4: (payout.account_number ?? '').slice(-4),
      payoutSettingsUrl: platformAppUrl('/coach/payouts'),
    }), 'payout_failed');
  }

  void logAudit({
    action: name.replace('.', '_'), table: 'instructor_payouts',
    gymId: payout.gym_id, recordId: payout.id,
    values: { amount: payout.amount, instructor_id: payout.instructor_id, transfer_code: transferCode },
  });
  return { ok: true };
}
