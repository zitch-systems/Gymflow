'use server';

import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import {
  resolveAccount,
  createTransferRecipient,
  initiateTransfer,
} from '@/lib/paystack';

type Result = { ok: boolean; error?: string };

// 10-digit NUBAN; Paystack rejects anything else but we reject early
// to give the admin a clean error before we hit the network.
const NUBAN_RE = /^\d{10}$/;
const BANK_CODE_RE = /^\d{3,6}$/;

/**
 * Admin-initiated payout. Two-phase flow:
 *  1. Resolve the bank+account against Paystack so the admin sees the
 *     account name before money moves.
 *  2. On confirmation, create (or reuse) a Paystack transfer recipient and
 *     initiate the transfer. The row's status moves to 'approved' here;
 *     the webhook flips it to 'paid' when transfer.success arrives.
 *
 * Reuse of recipient_code: if the same instructor was paid before to the
 * same bank+account, we look up the prior payout's paystack_recipient_code
 * and re-use it instead of creating a duplicate Paystack recipient.
 */
export async function processPayout(slug: string, payoutId: string, formData: FormData): Promise<Result> {
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();

  const bankCode = String(formData.get('bank_code') ?? '').trim();
  const bankName = String(formData.get('bank_name') ?? '').trim();
  const accountNumber = String(formData.get('account_number') ?? '').trim();
  if (!BANK_CODE_RE.test(bankCode)) return { ok: false, error: 'Invalid bank code' };
  if (!NUBAN_RE.test(accountNumber)) return { ok: false, error: 'Account number must be 10 digits' };
  if (!bankName) return { ok: false, error: 'Bank name required' };

  const admin = createAdminClient();

  // Service-role: this is an admin operation that needs to read the full
  // payout row regardless of RLS, and write columns (paystack_*) that the
  // staff client wouldn't have policy access to.
  const { data: payout, error: fetchErr } = await admin
    .from('instructor_payouts')
    .select('id, gym_id, instructor_id, amount, status')
    .eq('id', payoutId)
    .eq('gym_id', gym.id)
    .maybeSingle();
  if (fetchErr || !payout) return { ok: false, error: 'Payout not found' };
  if (payout.status !== 'requested') {
    return { ok: false, error: `Payout already ${payout.status}` };
  }

  // Resolve to surface mismatched accounts BEFORE creating the recipient.
  // Paystack creates recipients even for valid-but-wrong-named accounts,
  // and recipients can't be edited — only deleted, which costs an API call
  // and leaves a dangling code. Resolving first keeps things clean.
  let accountName: string;
  try {
    const resolved = await resolveAccount(accountNumber, bankCode);
    accountName = resolved.account_name;
  } catch (e) {
    return { ok: false, error: `Could not resolve account: ${(e as Error).message}` };
  }

  // Reuse an existing recipient_code if this coach was paid to the same
  // bank+account before. Saves a Paystack recipient row per duplicate pair.
  // paystack_recipient_code / paystack_transfer_code / bank_* are not yet
  // in the generated types (migrations 20260529_*); cast through `never`.
  const { data: priorRecipient } = await admin
    .from('instructor_payouts')
    .select('paystack_recipient_code' as never)
    .eq('gym_id', gym.id)
    .eq('instructor_id', payout.instructor_id)
    .eq('bank_code' as never, bankCode)
    .eq('account_number' as never, accountNumber)
    .not('paystack_recipient_code' as never, 'is', null)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let recipientCode = (priorRecipient as { paystack_recipient_code?: string } | null)?.paystack_recipient_code ?? null;
  if (!recipientCode) {
    try {
      const recipient = await createTransferRecipient({
        name: accountName,
        accountNumber,
        bankCode,
      });
      recipientCode = recipient.recipient_code;
    } catch (e) {
      return { ok: false, error: `Recipient creation failed: ${(e as Error).message}` };
    }
  }

  // The transfer reference is our payout id — Paystack treats reference as
  // an idempotency key, so a retry of the same payout id can't double-pay.
  let transferCode: string;
  try {
    const transfer = await initiateTransfer({
      amount: Number(payout.amount),
      recipientCode,
      reason: `GymFlow payout · ${gym.name}`,
      reference: payout.id,
    });
    transferCode = transfer.transfer_code;
  } catch (e) {
    return { ok: false, error: `Transfer failed: ${(e as Error).message}` };
  }

  const { error: updateErr } = await admin
    .from('instructor_payouts')
    .update({
      status: 'approved',
      processed_by: actor?.id ?? null,
      processed_at: new Date().toISOString(),
      // Cast through `never` for columns added by the 20260529_* migrations
      // that aren't in the generated types yet.
      bank_code: bankCode,
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
      paystack_recipient_code: recipientCode,
      paystack_transfer_code: transferCode,
    } as never)
    .eq('id', payout.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: payout.instructor_id,
    action: 'admin.payout_processed',
    table: 'instructor_payouts',
    recordId: payout.id,
    before: { status: 'requested' },
    after: {
      status: 'approved',
      amount: payout.amount,
      bank_code: bankCode,
      bank_name: bankName,
      account_number_last4: accountNumber.slice(-4),
      paystack_transfer_code: transferCode,
    },
  });

  revalidatePath(`/gym/${slug}/admin/payouts`);
  return { ok: true };
}

export async function rejectPayout(slug: string, payoutId: string, reason: string): Promise<Result> {
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();
  const admin = createAdminClient();

  const { data: payout } = await admin
    .from('instructor_payouts')
    .select('id, gym_id, instructor_id, status, amount')
    .eq('id', payoutId)
    .eq('gym_id', gym.id)
    .maybeSingle();
  if (!payout) return { ok: false, error: 'Payout not found' };
  if (payout.status !== 'requested') {
    return { ok: false, error: `Payout already ${payout.status}` };
  }

  const { error } = await admin
    .from('instructor_payouts')
    .update({
      status: 'rejected',
      processed_by: actor?.id ?? null,
      processed_at: new Date().toISOString(),
      notes: reason || null,
    })
    .eq('id', payout.id);
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: payout.instructor_id,
    action: 'admin.payout_rejected',
    table: 'instructor_payouts',
    recordId: payout.id,
    before: { status: 'requested' },
    after: { status: 'rejected', reason },
  });

  revalidatePath(`/gym/${slug}/admin/payouts`);
  return { ok: true };
}
