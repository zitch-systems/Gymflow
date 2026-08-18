import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSubaccount, DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';

// Shared "make sure this payout account has a live Paystack subaccount, and
// keep gyms mirrored to it" logic — used by the gym-facing payout-account
// actions (lib/actions/payout-accounts.ts) and by the reconciliation sweep
// (lib/reconcile.ts reconcileGymSplits), which needs to force a fresh
// subaccount when the stored code no longer resolves at Paystack. One
// implementation, two callers, so the recreate path can never drift from the
// original create path.

/* eslint-disable @typescript-eslint/no-explicit-any */
// See lib/checkin-core.ts for why the client type is loose here: this runs
// against both the cookie-scoped SSR client (payout-accounts.ts) and the
// service-role admin client (the reconciliation sweep).
type Sb = SupabaseClient<any, any, any>;

export type PayoutAccount = {
  id: string; gym_id: string; bank_name: string; bank_code: string;
  account_number: string; account_name: string; verified: boolean; is_active: boolean;
  paystack_subaccount_code: string | null;
};

// Mirror the gym's active payout account onto the gyms row (bank_* +
// paystack_subaccount_code) so member billing, which reads gyms, keeps working.
// A gym with no active account has its payout fields cleared.
export async function syncGymFromActive(supabase: Sb, gymId: string): Promise<void> {
  const { data } = await supabase.from('gym_payout_accounts' as never)
    .select('bank_name, bank_code, account_number, account_name, paystack_subaccount_code')
    .eq('gym_id', gymId).eq('is_active', true).maybeSingle();
  const a = data as unknown as Pick<PayoutAccount, 'bank_name' | 'bank_code' | 'account_number' | 'account_name' | 'paystack_subaccount_code'> | null;
  await supabase.from('gyms').update({
    bank_name: a?.bank_name ?? null,
    bank_code: a?.bank_code ?? null,
    account_number: a?.account_number ?? null,
    account_name: a?.account_name ?? null,
    paystack_subaccount_code: a?.paystack_subaccount_code ?? null,
    // "Payout configured" flag used by the onboarding checklist.
    payouts_locked: !!a,
  } as never).eq('id', gymId);
}

// Ensure the given account has a Paystack subaccount (needed for split payouts).
// Best-effort by default: without Paystack keys, or when creation fails, the
// account is still saved so the gym has its details on file — the caller gets
// the reason back rather than a bare null, so the reconciliation sweep can
// record why a recreate attempt failed. `force` bypasses the "already has a
// code" short-circuit — the sweep uses it to replace a code that no longer
// resolves at Paystack (created under a different key/mode, or deleted there).
export async function ensureSubaccount(
  supabase: Sb,
  account: PayoutAccount, businessName: string, commissionPct: number | null,
  opts?: { force?: boolean },
): Promise<{ ok: true; subaccountCode: string } | { ok: false; error: string }> {
  if (account.paystack_subaccount_code && !opts?.force) {
    return { ok: true, subaccountCode: account.paystack_subaccount_code };
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'PAYSTACK_SECRET_KEY is not set' };
  const sub = await createSubaccount({
    businessName,
    bankCode: account.bank_code,
    accountNumber: account.account_number,
    percentageCharge: commissionPct == null ? DEFAULT_PLATFORM_COMMISSION_PCT : Number(commissionPct),
  });
  if (!sub.ok) return sub;
  await supabase.from('gym_payout_accounts' as never).update({ paystack_subaccount_code: sub.subaccountCode } as never).eq('id', account.id);
  return sub;
}
