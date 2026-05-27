'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireManager } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { resolveAccount, createSubaccount, updateSubaccount, listBanks } from '@/lib/paystack';

type Result = { ok: boolean; error?: string };

// Both helpers below proxy Paystack endpoints, so they require manager auth —
// otherwise verifyAccountName would be an open account-number → name lookup
// oracle (privacy leak + Paystack rate-limit/cost abuse).
export async function fetchBanks(slug: string): Promise<{ ok: boolean; banks?: { code: string; name: string }[]; error?: string }> {
  await requireManager(slug);
  try {
    const banks = await listBanks();
    return { ok: true, banks: banks.map((b) => ({ code: b.code, name: b.name })) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function verifyAccountName(slug: string, formData: FormData): Promise<{ ok: boolean; accountName?: string; error?: string }> {
  await requireManager(slug);
  const accountNumber = String(formData.get('account_number') ?? '').trim();
  const bankCode = String(formData.get('bank_code') ?? '').trim();
  if (!/^\d{10}$/.test(accountNumber)) return { ok: false, error: 'Account number must be 10 digits' };
  if (!bankCode) return { ok: false, error: 'Bank required' };
  try {
    const result = await resolveAccount(accountNumber, bankCode);
    return { ok: true, accountName: result.account_name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function connectPaystackSubaccount(slug: string, formData: FormData): Promise<Result> {
  // Changing the settlement bank account is owner/manager-only.
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();

  const accountNumber = String(formData.get('account_number') ?? '').trim();
  const bankCode = String(formData.get('bank_code') ?? '').trim();
  const bankName = String(formData.get('bank_name') ?? '').trim() || null;
  if (!/^\d{10}$/.test(accountNumber)) return { ok: false, error: 'Account number must be 10 digits' };
  if (!bankCode) return { ok: false, error: 'Bank required' };

  const admin = createAdminClient();

  // Resolve & verify the account name matches before creating subaccount.
  let accountName: string;
  try {
    const resolved = await resolveAccount(accountNumber, bankCode);
    accountName = resolved.account_name;
  } catch (e) {
    return { ok: false, error: `Account verification failed: ${(e as Error).message}` };
  }

  const commission = Number(gym.platform_commission_pct ?? 5);
  const existingCode = gym.paystack_subaccount_code;

  try {
    if (existingCode) {
      await updateSubaccount(existingCode, {
        businessName: gym.name,
        bankCode,
        accountNumber,
        percentageCharge: commission,
      });
    } else {
      const created = await createSubaccount({
        businessName: gym.name,
        bankCode,
        accountNumber,
        percentageCharge: commission,
        primaryContactEmail: gym.email ?? undefined,
        primaryContactPhone: gym.phone ?? undefined,
      });
      await admin
        .from('gyms')
        .update({ paystack_subaccount_code: created.subaccount_code })
        .eq('id', gym.id);
    }
  } catch (e) {
    return { ok: false, error: `Paystack: ${(e as Error).message}` };
  }

  await admin
    .from('gyms')
    .update({
      bank_code: bankCode,
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gym.id);

  await admin.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: actor?.id ?? null,
    action: existingCode ? 'admin.subaccount_updated' : 'admin.subaccount_created',
    table_name: 'gyms',
    record_id: gym.id,
    new_values: { bank_code: bankCode, account_number: accountNumber, account_name: accountName },
  });

  revalidatePath(`/gym/${slug}/admin/settings/payouts`);
  return { ok: true };
}
