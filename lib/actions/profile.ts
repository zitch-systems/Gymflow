'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { splitName } from '@/lib/format';

export type SaveState = { ok: boolean; error: string | null };

// Member edits their own profile. RLS (profiles_update_no_escalation) restricts
// to id = auth.uid() and blocks any role change, so this is safe on the session.
export async function updateMemberProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await requireAuth();
  const full_name = String(formData.get('full_name') ?? '').trim().slice(0, 120);
  if (!full_name) return { ok: false, error: 'Your name is required.' };
  // full_name is GENERATED in the live DB — update the split parts instead.
  const patch = {
    ...splitName(full_name),
    phone: String(formData.get('phone') ?? '').trim().slice(0, 32) || null,
    date_of_birth: String(formData.get('date_of_birth') ?? '') || null,
    gender: String(formData.get('gender') ?? '').trim().slice(0, 24) || null,
    address: String(formData.get('address') ?? '').trim().slice(0, 300) || null,
    emergency_contact_name: String(formData.get('emergency_contact_name') ?? '').trim().slice(0, 120) || null,
    emergency_contact_phone: String(formData.get('emergency_contact_phone') ?? '').trim().slice(0, 32) || null,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  redirect('/dashboard/profile');
}

// Update the signed-in user's own profile row. RLS restricts the update to
// id = auth.uid(), so no service role is needed.
export async function updateOwnProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await requireAuth();
  const full_name = String(formData.get('full_name') ?? '').trim().slice(0, 120);
  const specialisation = String(formData.get('specialisation') ?? '').trim().slice(0, 160) || null;
  const bio = String(formData.get('bio') ?? '').trim().slice(0, 2000) || null;
  if (!full_name) return { ok: false, error: 'Name is required.' };

  const supabase = await createClient();
  // full_name is GENERATED in the live DB — update the split parts instead.
  const { error } = await supabase
    .from('profiles')
    .update({ ...splitName(full_name), specialisation, bio, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/coach/settings');
  revalidatePath('/coach');
  return { ok: true, error: null };
}
