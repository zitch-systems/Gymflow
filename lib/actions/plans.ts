'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export async function createPlan(slug: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const name = String(formData.get('name') ?? '').trim();
  const price = Number(formData.get('price') ?? 0);
  const duration_months = Number(formData.get('duration_months') ?? 1);
  const description = String(formData.get('description') ?? '').trim() || null;
  const is_active = formData.get('is_active') !== null;

  if (!name || price <= 0 || duration_months <= 0) return;

  const supabase = await createClient();
  const { data: created } = await supabase
    .from('membership_plans')
    .insert({
      gym_id: gym.id,
      name,
      price,
      duration_months,
      description,
      is_active,
      currency: 'NGN',
    })
    .select('id')
    .maybeSingle();
  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.plan_created',
    table: 'membership_plans',
    recordId: created?.id ?? null,
    after: { name, price, duration_months, description, is_active },
  });
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}

export async function updatePlan(slug: string, planId: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const name = String(formData.get('name') ?? '').trim();
  const price = Number(formData.get('price') ?? 0);
  const duration_months = Number(formData.get('duration_months') ?? 1);
  const description = String(formData.get('description') ?? '').trim() || null;
  const is_active = formData.get('is_active') !== null;

  const supabase = await createClient();
  // Snapshot the existing row first so the audit entry has the before-state
  // for diffing. .select() before .update() rather than after so RLS doesn't
  // hide rows we just mutated.
  const { data: before } = await supabase
    .from('membership_plans')
    .select('name, price, duration_months, description, is_active')
    .eq('id', planId)
    .eq('gym_id', gym.id)
    .maybeSingle();
  await supabase
    .from('membership_plans')
    .update({ name, price, duration_months, description, is_active })
    .eq('id', planId)
    .eq('gym_id', gym.id);
  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.plan_updated',
    table: 'membership_plans',
    recordId: planId,
    before: before ?? null,
    after: { name, price, duration_months, description, is_active },
  });
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}

export async function deletePlan(slug: string, planId: string) {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('membership_plans')
    .select('name, price, duration_months')
    .eq('id', planId)
    .eq('gym_id', gym.id)
    .maybeSingle();
  await supabase.from('membership_plans').delete().eq('id', planId).eq('gym_id', gym.id);
  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.plan_deleted',
    table: 'membership_plans',
    recordId: planId,
    before: before ?? null,
  });
  revalidatePath('/admin/pricing');
  revalidatePath('/dashboard/renew');
}
