'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { verifyPassword } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { createSubaccount, resolveAccount, DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';

export type PayoutState = { ok: boolean; error: string | null };

const MAX_ACCOUNTS = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Account = {
  id: string; gym_id: string; bank_name: string; bank_code: string;
  account_number: string; account_name: string; verified: boolean; is_active: boolean;
  paystack_subaccount_code: string | null;
};

// Mirror the gym's active payout account onto the gyms row (bank_* +
// paystack_subaccount_code) so member billing, which reads gyms, keeps working.
// A gym with no active account has its payout fields cleared.
async function syncGymFromActive(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gymId: string,
) {
  const { data } = await supabase.from('gym_payout_accounts' as never)
    .select('bank_name, bank_code, account_number, account_name, paystack_subaccount_code')
    .eq('gym_id', gymId).eq('is_active', true).maybeSingle();
  const a = data as unknown as Pick<Account, 'bank_name' | 'bank_code' | 'account_number' | 'account_name' | 'paystack_subaccount_code'> | null;
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
// Best-effort: without Paystack keys or on failure we leave it null — the
// account is still saved so the gym has its details on file.
async function ensureSubaccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  account: Account, businessName: string, commissionPct: number | null,
): Promise<string | null> {
  if (account.paystack_subaccount_code) return account.paystack_subaccount_code;
  if (!process.env.PAYSTACK_SECRET_KEY) return null;
  const sub = await createSubaccount({
    businessName,
    bankCode: account.bank_code,
    accountNumber: account.account_number,
    percentageCharge: commissionPct == null ? DEFAULT_PLATFORM_COMMISSION_PCT : Number(commissionPct),
  });
  if (!sub.ok) return null;
  await supabase.from('gym_payout_accounts' as never).update({ paystack_subaccount_code: sub.subaccountCode } as never).eq('id', account.id);
  return sub.subaccountCode;
}

// Add a payout account (up to MAX_ACCOUNTS). Requires the caller's password
// (step-up authorization — this is a money-redirection surface, so a hijacked
// session alone isn't enough) and, whenever Paystack is configured, a
// successful bank-name resolution (verification — the account must be real,
// not just typed in). Without Paystack keys there's no way to verify
// automatically, so that check is skipped and the account is saved
// unverified, same as before. The first account a gym adds becomes active
// automatically.
export async function addPayoutAccount(_prev: PayoutState, formData: FormData): Promise<PayoutState> {
  const bank_name = String(formData.get('bank_name') ?? '').trim();
  const bank_code = String(formData.get('bank_code') ?? '').trim();
  const account_number = String(formData.get('account_number') ?? '').trim();
  const account_name = String(formData.get('account_name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!bank_name || !/^\d{3,6}$/.test(bank_code) || !/^\d{10}$/.test(account_number) || !account_name) {
    return { ok: false, error: 'Pick a bank and enter a 10-digit account number and the account name.' };
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const reauth = await verifyPassword(password);
    if (reauth.error) return { ok: false, error: reauth.error };
    const supabase = await createClient();

    const { data: existing } = await supabase.from('gym_payout_accounts' as never)
      .select('id, is_active, account_number, bank_code').eq('gym_id', gym.id);
    const rows = (existing as unknown as { id: string; is_active: boolean; account_number: string; bank_code: string }[]) ?? [];
    if (rows.length >= MAX_ACCOUNTS) return { ok: false, error: `You can save up to ${MAX_ACCOUNTS} payout accounts.` };
    if (rows.some((r) => r.account_number === account_number && r.bank_code === bank_code)) {
      return { ok: false, error: 'That account is already saved.' };
    }

    let resolvedName = account_name;
    let verified = false;
    if (process.env.PAYSTACK_SECRET_KEY) {
      const r = await resolveAccount(account_number, bank_code);
      if (!r.ok) return { ok: false, error: r.error || 'Could not verify this account with the bank. Check the details and try again.' };
      resolvedName = r.accountName || account_name;
      verified = true;
    }

    const makeActive = rows.length === 0; // first account is active
    const { data: inserted, error } = await supabase.from('gym_payout_accounts' as never).insert({
      gym_id: gym.id, bank_name, bank_code, account_number, account_name: resolvedName,
      verified, is_active: makeActive,
    } as never).select('id, gym_id, bank_name, bank_code, account_number, account_name, verified, is_active, paystack_subaccount_code').maybeSingle();
    if (error) return { ok: false, error: error.message };

    if (makeActive && inserted) {
      await ensureSubaccount(supabase, inserted as unknown as Account, gym.name, gym.platform_commission_pct ?? null);
      await syncGymFromActive(supabase, gym.id);
    }
    logAudit({ action: 'payout_account_added', table: 'gym_payout_accounts', actorId: user.id, gymId: gym.id, values: { bank_name, last4: account_number.slice(-4), verified } });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Switch which saved account is active — the actual money-redirection step,
// so it needs the caller's password (step-up authorization) and, whenever
// Paystack is configured, a verified account (an unverified account can't
// become the one receiving real payouts). Self-service among the gym's own
// accounts otherwise — no platform approval.
export async function setActivePayoutAccount(_prev: PayoutState, formData: FormData): Promise<PayoutState> {
  const accountId = String(formData.get('account_id') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!UUID_RE.test(accountId)) return { ok: false, error: 'Invalid account.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const reauth = await verifyPassword(password);
    if (reauth.error) return { ok: false, error: reauth.error };
    const supabase = await createClient();
    const { data: acc } = await supabase.from('gym_payout_accounts' as never)
      .select('id, gym_id, bank_name, bank_code, account_number, account_name, verified, is_active, paystack_subaccount_code')
      .eq('id', accountId).eq('gym_id', gym.id).maybeSingle();
    const account = acc as unknown as Account | null;
    if (!account) return { ok: false, error: 'Account not found.' };
    if (process.env.PAYSTACK_SECRET_KEY && !account.verified) {
      return { ok: false, error: 'This account still needs bank verification before it can receive payouts.' };
    }

    // Clear the current active, then set this one — the partial unique index
    // forbids two active rows, so deactivate first.
    await supabase.from('gym_payout_accounts' as never).update({ is_active: false } as never).eq('gym_id', gym.id).eq('is_active', true);
    const { error } = await supabase.from('gym_payout_accounts' as never).update({ is_active: true, updated_at: new Date().toISOString() } as never).eq('id', account.id);
    if (error) return { ok: false, error: error.message };

    await ensureSubaccount(supabase, { ...account, is_active: true }, gym.name, gym.platform_commission_pct ?? null);
    await syncGymFromActive(supabase, gym.id);
    logAudit({ action: 'payout_account_activated', table: 'gym_payout_accounts', actorId: user.id, gymId: gym.id, recordId: account.id, values: { last4: account.account_number.slice(-4) } });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Remove a saved account — requires the caller's password (step-up
// authorization), same as switching the active account. If the removed
// account was active, the newest remaining account (if any) becomes active
// and the gyms row is re-synced.
export async function removePayoutAccount(_prev: PayoutState, formData: FormData): Promise<PayoutState> {
  const accountId = String(formData.get('account_id') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!UUID_RE.test(accountId)) return { ok: false, error: 'Invalid account.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const reauth = await verifyPassword(password);
    if (reauth.error) return { ok: false, error: reauth.error };
    const supabase = await createClient();
    const { data: acc } = await supabase.from('gym_payout_accounts' as never)
      .select('id, is_active, account_number').eq('id', accountId).eq('gym_id', gym.id).maybeSingle();
    const account = acc as unknown as { id: string; is_active: boolean; account_number: string } | null;
    if (!account) return { ok: false, error: 'Account not found.' };

    const { error } = await supabase.from('gym_payout_accounts' as never).delete().eq('id', account.id);
    if (error) return { ok: false, error: error.message };

    if (account.is_active) {
      // Promote the most recently added remaining account, if any — but only
      // one that's actually verified (when verification is possible at all),
      // so removing the active account can't silently hand payouts to an
      // unverified one without ever going through setActivePayoutAccount's checks.
      let next = supabase.from('gym_payout_accounts' as never)
        .select('id').eq('gym_id', gym.id).order('created_at', { ascending: false }).limit(1);
      if (process.env.PAYSTACK_SECRET_KEY) next = next.eq('verified', true);
      const { data: nextRow } = await next.maybeSingle();
      const nextId = (nextRow as unknown as { id: string } | null)?.id;
      if (nextId) await supabase.from('gym_payout_accounts' as never).update({ is_active: true } as never).eq('id', nextId);
      await syncGymFromActive(supabase, gym.id);
    }
    logAudit({ action: 'payout_account_removed', table: 'gym_payout_accounts', actorId: user.id, gymId: gym.id, recordId: account.id, values: { last4: account.account_number.slice(-4) } });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
