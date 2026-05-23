'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export async function upsertBusinessHours(slug: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();

  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    const isClosed = formData.get(`closed_${dow}`) !== null;
    const open = String(formData.get(`open_${dow}`) ?? '') || null;
    const close = String(formData.get(`close_${dow}`) ?? '') || null;
    rows.push({
      gym_id: gym.id,
      day_of_week: dow,
      is_closed: isClosed,
      open_time: isClosed ? null : open,
      close_time: isClosed ? null : close,
    });
  }

  // Delete then insert — simple but reliable for 7 rows.
  await supabase.from('business_hours').delete().eq('gym_id', gym.id);
  await supabase.from('business_hours').insert(rows);
  revalidatePath('/admin/business-hours');
}
