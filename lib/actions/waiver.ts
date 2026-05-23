'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export async function saveWaiver(slug: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const title = String(formData.get('title') ?? '').trim() || 'Membership waiver';
  const content = String(formData.get('content') ?? '').trim();
  const version = String(formData.get('version') ?? '').trim() || '1.0';
  if (!content) return;

  const supabase = await createClient();
  // Deactivate previous versions then create new active one.
  await supabase.from('waivers').update({ is_active: false }).eq('gym_id', gym.id);
  await supabase.from('waivers').insert({
    gym_id: gym.id,
    title,
    content,
    version,
    is_active: true,
  });
  revalidatePath('/admin/waiver');
}
