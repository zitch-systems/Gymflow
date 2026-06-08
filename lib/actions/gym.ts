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

const HEX = /^#[0-9a-fA-F]{6}$/;

// Save the gym's accent colour (applied across the member app).
export async function updateBranding(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const color = String(formData.get('brand_color') ?? '').trim();
  if (!HEX.test(color)) return { ok: false, error: 'Pick a valid colour.' };
  try {
    const { gym } = await requireStaff();
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
