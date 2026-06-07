'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export async function saveLandingPage(slug: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();
  const updates = {
    tagline: String(formData.get('tagline') ?? '').trim() || null,
    description: String(formData.get('description') ?? '').trim() || null,
    hero_image_url: String(formData.get('hero_image_url') ?? '').trim() || null,
    address: String(formData.get('address') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    landing_content: String(formData.get('landing_content') ?? '').trim() || null,
    landing_enabled: formData.get('landing_enabled') !== null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('gyms').update(updates).eq('id', gym.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/admin/settings/landing`);
  revalidatePath(`/gym/${slug}`);
  return { ok: true };
}
