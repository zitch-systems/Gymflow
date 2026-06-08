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

// Upload a gym logo to the gym-assets bucket and save its public URL. The
// storage RLS requires the path's first segment to be the gym id.
export async function uploadLogo(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose an image to upload.' };
  if (!file.type.startsWith('image/')) return { ok: false, error: 'File must be an image.' };
  if (file.size > 2_000_000) return { ok: false, error: 'Image must be under 2 MB.' };
  try {
    const { gym } = await requireStaff();
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
