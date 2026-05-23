'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export async function createPlan(slug: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const name = String(formData.get('name') ?? '').trim();
  const price = Number(formData.get('price') ?? 0);
  const duration_months = Number(formData.get('duration_months') ?? 1);
  const description = String(formData.get('description') ?? '').trim() || null;
  const is_active = formData.get('is_active') !== null;

  if (!name || price <= 0 || duration_months <= 0) return;

  const supabase = await createClient();
  await supabase.from('membership_plans').insert({
    gym_id: gym.id,
    name,
    price,
    duration_months,
    description,
    is_active,
    currency: 'NGN',
  });
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}

export async function updatePlan(slug: string, planId: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const name = String(formData.get('name') ?? '').trim();
  const price = Number(formData.get('price') ?? 0);
  const duration_months = Number(formData.get('duration_months') ?? 1);
  const description = String(formData.get('description') ?? '').trim() || null;
  const is_active = formData.get('is_active') !== null;

  const supabase = await createClient();
  await supabase
    .from('membership_plans')
    .update({ name, price, duration_months, description, is_active })
    .eq('id', planId)
    .eq('gym_id', gym.id);
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}

export async function deletePlan(slug: string, planId: string) {
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();
  await supabase.from('membership_plans').delete().eq('id', planId).eq('gym_id', gym.id);
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}
