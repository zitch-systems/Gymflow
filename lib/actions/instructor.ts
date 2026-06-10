'use server';

import { revalidatePath } from 'next/cache';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type MarkResult = { ok: boolean; error: string | null };

// Mark a PT session attended/no-show. RLS (isess_update_instructor) restricts
// updates to the instructor's own sessions, so the user session suffices.
export async function markSession(sessionId: string, status: 'completed' | 'no_show'): Promise<MarkResult> {
  const { user } = await requireInstructor();
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_sessions')
    .update({ status, marked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('instructor_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/coach/attendance');
  revalidatePath('/coach');
  return { ok: true, error: null };
}

// Save the instructor's payout account (upsert own row). Needs the
// instructor_bank_details self policies from the self_service_policies
// migration.
export async function saveBankDetails(_prev: MarkResult, formData: FormData): Promise<MarkResult> {
  const bank_name = String(formData.get('bank_name') ?? '').trim();
  const bank_code = String(formData.get('bank_code') ?? '').trim();
  const account_number = String(formData.get('account_number') ?? '').replace(/\s/g, '');
  const account_name = String(formData.get('account_name') ?? '').trim();
  if (!bank_name || !account_number || !account_name) return { ok: false, error: 'Bank, account number and account name are required.' };
  if (!/^\d{10}$/.test(account_number)) return { ok: false, error: 'NUBAN account numbers are 10 digits.' };
  try {
    const { user } = await requireInstructor();
    const supabase = await createClient();
    const { error } = await supabase.from('instructor_bank_details').upsert(
      { instructor_id: user.id, bank_name, bank_code, account_number, account_name, updated_at: new Date().toISOString() },
      { onConflict: 'instructor_id' },
    );
    if (error) return { ok: false, error: error.message };
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
  if (!file.type.startsWith('image/')) return { ok: false, error: 'File must be an image.' };
  if (file.size > 2_000_000) return { ok: false, error: 'Image must be under 2 MB.' };
  try {
    const { user, gym } = await requireInstructor();
    const supabase = await createClient();
    const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
    const path = `${gym.id}/avatars/${user.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('gym-assets').upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, error: upErr.message };
    const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
    const { error } = await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', user.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/coach/settings');
    revalidatePath('/coach');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
