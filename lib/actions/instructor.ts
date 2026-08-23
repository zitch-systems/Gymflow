'use server';

import { revalidatePath } from 'next/cache';
import { requireInstructor } from '@/lib/auth/dal';
import { verifyPassword } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { resolveAccount, type ResolveResult } from '@/lib/paystack';
import { alertInstructorBankChanged } from '@/lib/payout-alerts';
import { rateLimit } from '@/lib/rate-limit';
import { storagePathFromPublicUrl } from '@/lib/format';
import { checkImage } from '@/lib/upload-image';

export type MarkResult = { ok: boolean; error: string | null };

// Mark a PT session attended/no-show. RLS (isess_update_instructor) restricts
// updates to the instructor's own sessions, so the user session suffices.
export async function markSession(sessionId: string, status: 'completed' | 'no_show'): Promise<MarkResult> {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_sessions')
    .update({ status, marked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('instructor_id', user.id)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/coach/attendance');
  revalidatePath('/coach');
  return { ok: true, error: null };
}

// Resolve the instructor's own account name at Paystack before they can save
// it — mirrors the verification the gym's payout accounts require. Called
// from the "Verify" button before the account name field is editable/final.
export async function verifyInstructorBankAccount(accountNumber: string, bankCode: string): Promise<ResolveResult> {
  if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,6}$/.test(bankCode)) {
    return { ok: false, error: 'Enter a 10-digit account number and bank code.' };
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Payments are not configured yet.' };
  const { user } = await requireInstructor();
  // Each call resolves a real account name at Paystack — throttle per user so
  // the endpoint can't be scripted into an account-name enumeration oracle.
  if (!(await rateLimit(`verify-bank:user:${user.id}`, 10, 600))) {
    return { ok: false, error: 'Too many lookups — wait a few minutes and try again.' };
  }
  return resolveAccount(accountNumber, bankCode);
}

// Save the instructor's payout account (upsert own row). Needs the
// instructor_bank_details self policies from the self_service_policies
// migration. Requires the caller's password (step-up authorization — this
// redirects where their own earnings get paid) and, whenever Paystack is
// configured, a successful bank-name resolution (verification). Without
// Paystack keys there's no automatic way to verify, so that check is skipped.
export async function saveBankDetails(_prev: MarkResult, formData: FormData): Promise<MarkResult> {
  const bank_name = String(formData.get('bank_name') ?? '').trim();
  const bank_code = String(formData.get('bank_code') ?? '').trim();
  const account_number = String(formData.get('account_number') ?? '').replace(/\s/g, '');
  const account_name = String(formData.get('account_name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!bank_name || !account_number || !account_name) return { ok: false, error: 'Bank, account number and account name are required.' };
  if (!/^\d{10}$/.test(account_number)) return { ok: false, error: 'NUBAN account numbers are 10 digits.' };
  try {
    const { user, gym } = await requireInstructor();
    const reauth = await verifyPassword(password);
    if (reauth.error) return { ok: false, error: reauth.error };

    let resolvedName = account_name;
    if (process.env.PAYSTACK_SECRET_KEY) {
      const r = await resolveAccount(account_number, bank_code);
      if (!r.ok) return { ok: false, error: r.error || 'Could not verify this account with the bank. Check the details and try again.' };
      resolvedName = r.accountName || account_name;
    }

    const supabase = await createClient();
    const { error } = await supabase.from('instructor_bank_details').upsert(
      { instructor_id: user.id, bank_name, bank_code, account_number, account_name: resolvedName, updated_at: new Date().toISOString() },
      { onConflict: 'instructor_id' },
    );
    if (error) return { ok: false, error: error.message };
    // Second line of defense: tell the coach their own payout bank changed.
    await alertInstructorBankChanged({ email: user.email, gymName: gym.name, bankName: bank_name, last4: account_number.slice(-4) });
    revalidatePath('/coach/payouts');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Save coach preferences: notification channels (real profiles columns) and
// teaching-availability days (profiles.availability jsonb — added by the
// 20260610_profiles_availability migration; degrades with a clear error until
// it's applied).
export async function savePrefs(_prev: MarkResult, formData: FormData): Promise<MarkResult> {
  const days = formData.getAll('day').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const notifEmail = formData.get('notification_email') === 'on';
  const notifWa = formData.get('notification_whatsapp') === 'on';
  try {
    const { user } = await requireInstructor();
    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ notification_email: notifEmail, notification_whatsapp: notifWa, availability: days, updated_at: new Date().toISOString() } as never)
      .eq('id', user.id);
    if (error) {
      // availability column not migrated yet → save what we can.
      if (/availability/i.test(error.message)) {
        const { error: e2 } = await supabase
          .from('profiles')
          .update({ notification_email: notifEmail, notification_whatsapp: notifWa, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        if (e2) return { ok: false, error: e2.message };
        return { ok: false, error: 'Notifications saved; availability needs the pending database migration.' };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath('/coach/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Upload a profile photo to gym-assets (path rooted at the gym id, matching
// the bucket's per-gym staff RLS) and save it on the profile.
export async function uploadAvatar(_prev: MarkResult, formData: FormData): Promise<MarkResult> {
  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a photo to upload.' };
  // Avatars render in admin lists and member booking cards, and the bucket is
  // public — an SVG here executes same-origin. See lib/upload-image.ts.
  const checked = checkImage(file, 2_000_000);
  if (!checked.ok) return { ok: false, error: checked.error };
  try {
    const { user, gym } = await requireInstructor();
    const supabase = await createClient();
    const path = `${gym.id}/avatars/${user.id}-${Date.now()}.${checked.ext}`;
    // Snapshot the current avatar BEFORE overwriting the pointer, so the old
    // object can be deleted (timestamped paths never overwrite → orphans).
    const { data: prevProfile } = await supabase.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle();
    const { error: upErr } = await supabase.storage.from('gym-assets').upload(path, file, { contentType: checked.contentType, upsert: true });
    if (upErr) return { ok: false, error: upErr.message };
    const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
    const { error } = await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', user.id);
    if (error) return { ok: false, error: error.message };
    const oldPath = storagePathFromPublicUrl(prevProfile?.avatar_url);
    if (oldPath && oldPath !== path) {
      try { await supabase.storage.from('gym-assets').remove([oldPath]); } catch { /* orphan tolerable */ }
    }
    revalidatePath('/coach/settings');
    revalidatePath('/coach');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
