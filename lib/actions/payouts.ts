'use server';

import { revalidatePath } from 'next/cache';
import { requireInstructor, requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTransferRecipient, initiateTransfer } from '@/lib/paystack';
import { availableBalance } from '@/lib/payout-balance';
import { logAudit } from '@/lib/audit';
import { gymHasFeature, upgradeMessage } from '@/lib/entitlements';
import { fmtDate } from '@/lib/format';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { adminOrNull, getContact, getGymOwnerEmails, type EmailContact } from '@/lib/email/recipients';
import { payoutRejected, payoutRequested, payoutSent } from '@/lib/email/templates/platform';

// Instructor payout runs — the money-movement half of the commission feature.
// Lifecycle (status is DB-check-constrained to these four values):
//
//   requested  — instructor asked for money (requestPayout)
//   approved   — transfer initiated at Paystack, money in flight (payPayout)
//   paid       — Paystack confirmed (instant success, or transfer.success webhook)
//   rejected   — staff declined (rejectPayout)
//
// transfer.failed / transfer.reversed put the row back to 'requested' with a
// note so staff can retry — see lib/transfer-fulfill.ts.

export type ActionState = { ok: boolean; error: string | null; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PayoutMailCtx = {
  admin: NonNullable<ReturnType<typeof adminOrNull>>;
  /** The instructor whose money this is. Null when their profile can't be read. */
  instructor: EmailContact | null;
};

// All three send sites below want the same two things: the service-role client
// (an instructor's profile and a gym's owner links are both outside the
// caller's RLS) and that instructor's contact row. Bundling the skip-when-off
// check, the client and the swallow here is what stops a payout action ever
// failing because of an email.
async function mailAboutPayout(instructorId: string, send: (ctx: PayoutMailCtx) => Promise<unknown>): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const admin = adminOrNull();
  if (!admin) return;
  try {
    await send({ admin, instructor: await getContact(admin, instructorId) });
  } catch { /* best-effort — the money has already moved (or hasn't) either way */ }
}

// Instructor requests a payout of `amount` naira. Bank details are snapshotted
// onto the row (the payouts table is denormalised by design — what staff pay
// to is what the instructor had verified at request time).
export async function requestPayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const amount = Math.floor(Number(formData.get('amount') ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
  try {
    const { user, gym } = await requireInstructor();
    // Tier gate: in-app payout runs are a Scale feature. Lower tiers still see
    // earnings; the gym settles instructors outside the app.
    if (!gymHasFeature(gym, 'instructor_payouts')) return { ok: false, error: 'In-app payouts are part of your gym\'s Scale plan. Ask the gym to upgrade, or settle directly with them.' };
    const supabase = await createClient();

    const [{ data: bank }, { data: open }] = await Promise.all([
      supabase.from('instructor_bank_details').select('bank_code, bank_name, account_number, account_name').eq('instructor_id', user.id).maybeSingle(),
      supabase.from('instructor_payouts').select('id').eq('gym_id', gym.id).eq('instructor_id', user.id).in('status', ['requested', 'approved']).limit(1).maybeSingle(),
    ]);
    if (!bank) return { ok: false, error: 'Add your bank account first (Payout account, above).' };
    if (open) return { ok: false, error: 'You already have a payout in progress. Wait for it to complete first.' };

    const sharePct = Number((gym as { instructor_revenue_share_pct?: number }).instructor_revenue_share_pct ?? 70);
    const available = await availableBalance(supabase, gym.id, user.id, sharePct);
    if (amount > available) {
      return { ok: false, error: `You can withdraw up to ₦${available.toLocaleString('en-NG')} right now.` };
    }

    // RLS (ipay_insert_instructor) enforces: own instructor_id, active
    // instructor link in this gym, status 'requested'.
    const { data: row, error } = await supabase.from('instructor_payouts').insert({
      gym_id: gym.id, instructor_id: user.id, amount, status: 'requested',
      bank_code: bank.bank_code, bank_name: bank.bank_name,
      account_number: bank.account_number, account_name: bank.account_name,
    }).select('id').single();
    // 23505 = the instructor_payouts_one_open partial unique index: a
    // concurrent request already opened a payout that our SELECT above missed
    // (both read "no open payout" before either inserted). Treat it as the
    // same "already in progress" case rather than a raw DB error.
    if (error?.code === '23505') return { ok: false, error: 'You already have a payout in progress. Wait for it to complete first.' };
    if (error) return { ok: false, error: error.message };

    // In-app row first — it is the system of record; the mail below is the
    // second channel. Written through the user client, not the service role:
    // notif_insert_self covers an instructor's own row, so the receipt an
    // instructor sees never depends on the service key being configured.
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gym.id, user_id: user.id, type: 'payment', channel: 'in_app',
      title: 'Payout requested',
      body: `Your ₦${amount.toLocaleString('en-NG')} payout request is with the gym for approval.`,
    });
    if (nErr) console.warn(`[payout] request notification failed: ${nErr.message}`); // the request itself succeeded

    // Owners get the mail, not the requester: nothing moves until one of them
    // approves it, so they are the only people who can act on this.
    await mailAboutPayout(user.id, async ({ admin, instructor }) => {
      const owners = await getGymOwnerEmails(admin, gym.id);
      if (owners.length === 0) return;
      return sendPlatformEmail({
        to: owners,
        ...payoutRequested({
          gymName: gym.name ?? 'your gym',
          instructorName: instructor?.fullName?.trim() || bank.account_name || 'An instructor',
          amountNaira: amount,
          bankName: bank.bank_name ?? '',
          last4: (bank.account_number ?? '').slice(-4),
          requestedDate: fmtDate(new Date().toISOString()),
          payoutsUrl: platformAppUrl('/admin/instructors'),
        }),
        template: 'payout_requested',
      });
    });

    void logAudit({
      action: 'payout_requested', table: 'instructor_payouts',
      actorId: user.id, gymId: gym.id, recordId: row.id,
      values: { amount },
    });
    revalidatePath('/coach/payouts');
    return { ok: true, error: null, message: 'Payout requested — the gym will review it shortly.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function rejectPayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const payoutId = String(formData.get('payoutId') ?? '');
  const note = String(formData.get('note') ?? '').slice(0, 300);
  if (!UUID_RE.test(payoutId)) return { ok: false, error: 'Invalid payout id.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    // Guarded transition: only an open request can be rejected. RLS
    // (ipay_update_admin) additionally pins the write to this staff's gym.
    const { data: rows, error } = await supabase.from('instructor_payouts')
      .update({ status: 'rejected', notes: note || 'Rejected by gym', processed_by: user.id, processed_at: new Date().toISOString() })
      .eq('id', payoutId).eq('gym_id', gym.id).eq('status', 'requested')
      .select('id, instructor_id, amount');
    if (error) return { ok: false, error: error.message };
    if (!rows?.length) return { ok: false, error: 'This payout is no longer open.' };
    const rejected = rows[0];

    // In-app row first (notif_insert_staff covers a manager writing to their
    // own gym's instructor), then the mail that carries the staff note.
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gym.id, user_id: rejected.instructor_id, type: 'warning', channel: 'in_app',
      title: 'Payout request declined',
      body: `Your ₦${Number(rejected.amount).toLocaleString('en-NG')} payout request was declined${note ? `: ${note}` : '.'}`,
    });
    if (nErr) console.warn(`[payout] rejection notification failed: ${nErr.message}`); // the rejection itself succeeded

    await mailAboutPayout(rejected.instructor_id, ({ instructor }) => {
      if (!instructor?.email) return Promise.resolve();
      return sendPlatformEmail({
        to: instructor.email,
        ...payoutRejected({
          instructorName: instructor.fullName,
          gymName: gym.name ?? 'your gym',
          amountNaira: Number(rejected.amount),
          note,
          earningsUrl: platformAppUrl('/coach/earnings'),
        }),
        template: 'payout_rejected',
      });
    });

    void logAudit({
      action: 'payout_rejected', table: 'instructor_payouts',
      actorId: user.id, gymId: gym.id, recordId: payoutId,
      values: { amount: rejected.amount, note: note || null },
    });
    revalidatePath('/admin/instructors');
    return { ok: true, error: null, message: 'Payout rejected.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Pay an open request: flip it to 'approved' atomically (the double-click /
// two-staff race guard — only the caller that wins the conditional UPDATE
// proceeds to move money), then create the Paystack recipient from the row's
// bank snapshot and initiate the transfer. Instant success → 'paid';
// queued/pending → stays 'approved' until transfer.success arrives.
export async function payPayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const payoutId = String(formData.get('payoutId') ?? '');
  if (!UUID_RE.test(payoutId)) return { ok: false, error: 'Invalid payout id.' };
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    if (!gymHasFeature(gym, 'instructor_payouts')) return { ok: false, error: upgradeMessage('instructor_payouts') };
    const supabase = await createClient();

    // 1 ── claim the row. status='requested' in the WHERE makes this a
    // compare-and-swap: a concurrent payer loses and gets zero rows back.
    const { data: claimed, error: claimErr } = await supabase.from('instructor_payouts')
      .update({ status: 'approved', processed_by: user.id, processed_at: new Date().toISOString() })
      .eq('id', payoutId).eq('gym_id', gym.id).eq('status', 'requested')
      // bank_name rides along for the payout email — the row's snapshot is what
      // the money actually went to, which is the point of telling them.
      .select('id, instructor_id, amount, bank_code, bank_name, account_number, account_name, paystack_recipient_code');
    if (claimErr) return { ok: false, error: claimErr.message };
    const payout = claimed?.[0];
    if (!payout) return { ok: false, error: 'This payout is no longer open (already paid, rejected, or being processed).' };

    // Rollback helper: give the row back to the queue if money can't move.
    const admin = createAdminClient();
    const unclaim = async (reason: string) => {
      await admin.from('instructor_payouts')
        .update({ status: 'requested', notes: reason.slice(0, 300), processed_by: null, processed_at: null })
        .eq('id', payout.id);
    };

    // 1b ── defence in depth: never transfer more than the instructor has
    // earned. The one-open-payout index already stops the double-request race
    // at the source, but re-check here (this row is now 'approved', so it's
    // counted in `committed`) so no path can pay out beyond the earned balance.
    const sharePct = Number((gym as { instructor_revenue_share_pct?: number }).instructor_revenue_share_pct ?? 70);
    const [{ data: subRows }, { data: payoutRows }] = await Promise.all([
      supabase.from('instructor_subscriptions').select('amount_paid').eq('gym_id', gym.id).eq('instructor_id', payout.instructor_id),
      supabase.from('instructor_payouts').select('amount, status').eq('gym_id', gym.id).eq('instructor_id', payout.instructor_id),
    ]);
    const earned = Math.floor(((subRows ?? []).reduce((s, r) => s + Number(r.amount_paid ?? 0), 0) * sharePct) / 100);
    const committed = (payoutRows ?? []).filter((p) => p.status !== 'rejected').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    if (committed > earned) {
      await unclaim('Exceeds available balance — earnings already covered by another payout.');
      return { ok: false, error: 'This payout exceeds the instructor’s available balance and was returned to the queue.' };
    }

    // 2 ── ensure a transfer recipient (cached on the row after first use).
    let recipient = payout.paystack_recipient_code;
    if (!recipient) {
      if (!payout.bank_code || !payout.account_number || !payout.account_name) {
        await unclaim('Missing bank details on the payout — ask the instructor to re-request.');
        return { ok: false, error: 'This payout has no bank snapshot. The instructor needs to re-request it.' };
      }
      const rec = await createTransferRecipient({
        name: payout.account_name, accountNumber: payout.account_number, bankCode: payout.bank_code,
      });
      if (!rec.ok) { await unclaim(`Recipient creation failed: ${rec.error}`); return { ok: false, error: rec.error }; }
      recipient = rec.recipientCode;
    }

    // 3 ── move the money. The reference embeds the payout id + a nonce: the
    // id ties the transfer back to this row for the webhook, the nonce lets a
    // later retry (after transfer.failed) use a fresh reference.
    const reference = `payout-${payout.id}-${Date.now().toString(36)}`;
    const tr = await initiateTransfer({
      amountKobo: Math.round(Number(payout.amount) * 100),
      recipientCode: recipient,
      reference,
      reason: `GymFlow payout — ${gym.name ?? 'gym'}`,
    });
    if (!tr.ok) { await unclaim(`Transfer failed to start: ${tr.error}`); return { ok: false, error: tr.error }; }

    // 4 ── record the outcome. Instant success closes the loop here; anything
    // else waits for the transfer.success webhook.
    const paidNow = tr.status === 'success';
    const { error: recErr } = await supabase.from('instructor_payouts')
      .update({
        paystack_recipient_code: recipient,
        paystack_transfer_code: tr.transferCode,
        ...(paidNow ? { status: 'paid' } : {}),
        notes: null,
      })
      .eq('id', payout.id).eq('gym_id', gym.id);
    if (recErr) console.error(`[payout] transfer ${tr.transferCode} initiated but recording failed: ${recErr.message}`); // webhook will still land the final state

    void logAudit({
      action: paidNow ? 'payout_paid' : 'payout_transfer_initiated',
      table: 'instructor_payouts',
      actorId: user.id, gymId: gym.id, recordId: payout.id,
      values: { amount: payout.amount, instructor_id: payout.instructor_id, transfer_code: tr.transferCode, reference },
    });

    // Tell the instructor.
    await admin.from('notifications').insert({
      gym_id: gym.id, user_id: payout.instructor_id, type: 'payment', channel: 'in_app',
      title: paidNow ? 'Payout sent' : 'Payout on the way',
      body: `₦${Number(payout.amount).toLocaleString('en-NG')} ${paidNow ? 'has been transferred to' : 'is being transferred to'} your ${payout.account_name} account.`,
    });

    // Money in flight is the moment an instructor most wants a written record —
    // and the one that stops "you said you paid me" an hour later.
    await mailAboutPayout(payout.instructor_id, ({ instructor }) => {
      if (!instructor?.email) return Promise.resolve();
      return sendPlatformEmail({
        to: instructor.email,
        ...payoutSent({
          instructorName: instructor.fullName,
          gymName: gym.name ?? 'your gym',
          amountNaira: Number(payout.amount),
          bankName: payout.bank_name ?? '',
          last4: (payout.account_number ?? '').slice(-4),
          reference,
          earningsUrl: platformAppUrl('/coach/earnings'),
        }),
        template: 'payout_sent',
      });
    });

    revalidatePath('/admin/instructors');
    return { ok: true, error: null, message: paidNow ? 'Paid — transfer completed.' : 'Transfer initiated — Paystack will confirm shortly.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
