'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/dal';

// Payout-account changes redirect every future member payment for the whole gym
// — a hijacked or compromised manager account could reroute a full billing
// cycle into their own bank. Restrict to the owner role only, matching the
// posture of platform-billing.ts's OWNER_ROLES. Password step-up still applies
// on top of this so a stolen owner session isn't enough on its own.
const OWNER_ROLES = ['gym_owner', 'owner'] as const;
import { verifyPassword } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { alertGymPayoutChanged } from '@/lib/payout-alerts';
import { resolveAccount } from '@/lib/paystack';
import { ensureSubaccount, syncGymFromActive, type PayoutAccount as Account } from '@/lib/payout-sync';

export type PayoutState = { ok: boolean; error: string | null };

const MAX_ACCOUNTS = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const { user, gym } = await requireStaff(OWNER_ROLES);
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
    await alertGymPayoutChanged({ gymId: gym.id, gymName: gym.name, action: 'added', bankName: bank_name, last4: account_number.slice(-4), actorId: user.id });
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
    const { user, gym } = await requireStaff(OWNER_ROLES);
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
    await alertGymPayoutChanged({ gymId: gym.id, gymName: gym.name, action: 'activated', bankName: account.bank_name, last4: account.account_number.slice(-4), actorId: user.id });
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
    const { user, gym } = await requireStaff(OWNER_ROLES);
    const reauth = await verifyPassword(password);
    if (reauth.error) return { ok: false, error: reauth.error };
    const supabase = await createClient();
    const { data: acc } = await supabase.from('gym_payout_accounts' as never)
      .select('id, is_active, account_number, bank_name').eq('id', accountId).eq('gym_id', gym.id).maybeSingle();
    const account = acc as unknown as { id: string; is_active: boolean; account_number: string; bank_name: string } | null;
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
    await alertGymPayoutChanged({ gymId: gym.id, gymName: gym.name, action: 'removed', bankName: account.bank_name, last4: account.account_number.slice(-4), actorId: user.id });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
