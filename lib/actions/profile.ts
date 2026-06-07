'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type SaveState = { ok: boolean; error: string | null };

// Update the signed-in user's own profile row. RLS restricts the update to
// id = auth.uid(), so no service role is needed.
export async function updateOwnProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await requireAuth();
  const full_name = String(formData.get('full_name') ?? '').trim();
  const specialisation = String(formData.get('specialisation') ?? '').trim() || null;
  const bio = String(formData.get('bio') ?? '').trim() || null;
  if (!full_name) return { ok: false, error: 'Name is required.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name, specialisation, bio, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/coach/settings');
  revalidatePath('/coach');
  return { ok: true, error: null };
}
