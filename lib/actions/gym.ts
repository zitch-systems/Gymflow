'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type GymSaveState = { ok: boolean; error: string | null };

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
    const { gym } = await requireStaff();
    const supabase = await createClient();
    const { error } = await supabase.from('gyms').update(patch).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/settings');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
