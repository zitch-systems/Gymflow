'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/dal';
import { getGymBySlug } from '@/lib/auth/gym';
import { audit } from '@/lib/audit';

type Result = { ok: boolean; error?: string };

/**
 * Member-controlled profile update. Currently covers:
 *   - phone
 *   - photo_url (avatar; uploaded to the gym-assets bucket client-side)
 *   - notification_email (NDPR opt-out for reminder/dunning emails)
 *   - notification_whatsapp (same, for WhatsApp)
 *
 * Authorization is enforced two ways:
 *   1. getSessionUser() — must be signed in.
 *   2. The user-scoped Supabase client's profiles_update_no_escalation RLS
 *      policy further restricts the update to auth.uid() = id AND no role
 *      change. We rely on that — never use the admin client here.
 */
export async function updateMemberProfile(
  slug: string,
  formData: FormData,
): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const gym = await getGymBySlug(slug);

  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw === '' ? null : phoneRaw;
  // Checkboxes: present (=== 'on') means enabled. Absent = unchecked = opted out.
  const notification_email = formData.get('notification_email') === 'on';
  const notification_whatsapp = formData.get('notification_whatsapp') === 'on';

  if (phone && !/^\+?[\d\s()-]{6,20}$/.test(phone)) {
    return { ok: false, error: 'Phone number looks invalid' };
  }

  // photo_url comes from the client storage upload. Empty string = removed.
  // Only accept our own gym-assets public URLs (or empty) so a tampered form
  // can't point the avatar at an arbitrary external URL.
  const photoRaw = String(formData.get('photo_url') ?? '').trim();
  let photo_url: string | null = null;
  if (photoRaw !== '') {
    if (!/\/storage\/v1\/object\/public\/gym-assets\//.test(photoRaw)) {
      return { ok: false, error: 'Invalid photo URL' };
    }
    photo_url = photoRaw;
  }

  const supabase = await createClient();

  // Snapshot the before-state for the audit entry. The two notification-pref
  // columns exist in the live DB once the migration runs but aren't yet in the
  // generated types (no `supabase gen types` reran), so we widen the row type
  // via `as never` on the select string + unknown cast on the return.
  const { data: beforeRaw } = await supabase
    .from('profiles')
    .select('phone, photo_url, notification_email, notification_whatsapp' as never)
    .eq('id', user.id)
    .maybeSingle();
  const before = beforeRaw as unknown as Record<string, unknown> | null;

  // The profiles row may not have these columns yet if the migration hasn't
  // been applied to the live DB. Cast through unknown to satisfy the older
  // generated types until the next supabase gen types run.
  const updatePayload: Record<string, unknown> = {
    phone,
    photo_url,
    notification_email,
    notification_whatsapp,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('profiles')
    .update(updatePayload as never)
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym?.id ?? null,
    actorId: user.id,
    userId: user.id,
    action: 'member.profile_updated',
    table: 'profiles',
    recordId: user.id,
    before: before ?? null,
    after: { phone, photo_url, notification_email, notification_whatsapp },
  });

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  return { ok: true };
}
