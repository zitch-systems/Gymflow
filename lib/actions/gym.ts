'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { createSubaccount, resolveAccount } from '@/lib/paystack';

export type GymSaveState = { ok: boolean; error: string | null };

export type VerifyAccountResult = { ok: true; accountName: string } | { ok: false; error: string };

// Interactive account-name lookup for the payout form (client → server, since it
// needs the Paystack secret key). Owners/managers only.
export async function verifyBankAccount(accountNumber: string, bankCode: string): Promise<VerifyAccountResult> {
  if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,6}$/.test(bankCode)) {
    return { ok: false, error: 'Enter a 10-digit account number and pick a bank.' };
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Payments are not configured yet.' };
  await requireStaff(MANAGER_ROLES);
  return resolveAccount(accountNumber, bankCode);
}

// Save the gym's payout bank account and, when Paystack is configured, create a
// Paystack subaccount so member dues settle to that bank directly (the platform
// keeps platform_commission_pct). Owners/managers only (gyms_update RLS).
export async function savePayout(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const bank_name = String(formData.get('bank_name') ?? '').trim();
  const bank_code = String(formData.get('bank_code') ?? '').trim();
  const account_number = String(formData.get('account_number') ?? '').trim();
  const account_name = String(formData.get('account_name') ?? '').trim();
  if (!bank_name || !/^\d{3,6}$/.test(bank_code) || !/^\d{10}$/.test(account_number) || !account_name) {
    return { ok: false, error: 'Enter bank name, bank code, a 10-digit account number and the account name.' };
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    // With Paystack configured, verify the account server-side and store the
    // canonical holder name (never trust the client's account_name).
    let resolvedName = account_name;
    if (process.env.PAYSTACK_SECRET_KEY) {
      const resolved = await resolveAccount(account_number, bank_code);
      if (!resolved.ok) return { ok: false, error: `Couldn’t verify account: ${resolved.error}` };
      resolvedName = resolved.accountName || account_name;
    }
    // Save the bank details first — useful even before Paystack keys are set.
    const { error: upErr } = await supabase.from('gyms')
      .update({ bank_name, bank_code, account_number, account_name: resolvedName }).eq('id', gym.id);
    if (upErr) return { ok: false, error: upErr.message };

    // With Paystack configured, (re)create the subaccount and store its code so
    // startRenewal can route settlement to this gym.
    if (process.env.PAYSTACK_SECRET_KEY) {
      const sub = await createSubaccount({
        businessName: gym.name,
        bankCode: bank_code,
        accountNumber: account_number,
        percentageCharge: Number(gym.platform_commission_pct ?? 0) || 0,
      });
      if (!sub.ok) return { ok: false, error: `Bank saved, but connecting payouts failed: ${sub.error}` };
      const { error: scErr } = await supabase.from('gyms').update({ paystack_subaccount_code: sub.subaccountCode }).eq('id', gym.id);
      if (scErr) return { ok: false, error: scErr.message };
    }
    logAudit({ action: 'payout_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: { bank_name, last4: account_number.slice(-4) } });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Update the gym's public profile. RLS gyms_update_owner_only restricts this to
// owners/managers of the gym.
export async function updateGym(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Gym name is required.' };
  const patch = {
    name,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    address: String(formData.get('address') ?? '').trim() || null,
  };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('gyms').update(patch).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'gym_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: patch });
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Upload a gym logo to the gym-assets bucket and save its public URL. The
// storage RLS requires the path's first segment to be the gym id.
export async function uploadLogo(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose an image to upload.' };
  if (!file.type.startsWith('image/')) return { ok: false, error: 'File must be an image.' };
  if (file.size > 2_000_000) return { ok: false, error: 'Image must be under 2 MB.' };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const ext = ((file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'png';
    const path = `${gym.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('gym-assets').upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, error: upErr.message };
    const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
    const { error } = await supabase.from('gyms').update({ logo_url: pub.publicUrl } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/settings');
    revalidatePath('/dashboard', 'layout');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

// Save the gym's accent colour (applied across the member app).
export async function updateBranding(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const color = String(formData.get('brand_color') ?? '').trim();
  if (!HEX.test(color)) return { ok: false, error: 'Pick a valid colour.' };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    // brand_color isn't in the generated types yet — cast to keep tsc happy.
    const { error } = await supabase.from('gyms').update({ brand_color: color } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/settings');
    revalidatePath('/dashboard', 'layout');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
