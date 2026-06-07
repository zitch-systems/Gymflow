'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export async function upsertEquipment(slug: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const status = String(formData.get('status') ?? 'available').trim();
  const location = String(formData.get('location') ?? '').trim() || null;
  const purchase_date = String(formData.get('purchase_date') ?? '').trim() || null;
  const purchase_price_raw = String(formData.get('purchase_price') ?? '').trim();
  const purchase_price = purchase_price_raw ? Number(purchase_price_raw) : null;
  const next_maintenance_date = String(formData.get('next_maintenance_date') ?? '').trim() || null;
  const photo_url = String(formData.get('photo_url') ?? '').trim() || null;
  const maintenance_notes = String(formData.get('maintenance_notes') ?? '').trim() || null;

  if (!name) return { ok: false, error: 'Name required' };

  const supabase = await createClient();
  const row = {
    gym_id: gym.id,
    name,
    category,
    status,
    location,
    purchase_date,
    purchase_price,
    next_maintenance_date,
    photo_url,
    maintenance_notes,
  };
  if (id) {
    const { data: before } = await supabase
      .from('equipment')
      .select('name, category, status, location, purchase_price, next_maintenance_date')
      .eq('id', id)
      .eq('gym_id', gym.id)
      .maybeSingle();
    const { error } = await supabase.from('equipment').update(row).eq('id', id).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    await audit({
      gymId: gym.id,
      actorId: actor?.id ?? null,
      action: 'admin.equipment_updated',
      table: 'equipment',
      recordId: id,
      before: before ?? null,
      after: row,
    });
  } else {
    const { data: created, error } = await supabase.from('equipment').insert(row).select('id').maybeSingle();
    if (error) return { ok: false, error: error.message };
    await audit({
      gymId: gym.id,
      actorId: actor?.id ?? null,
      action: 'admin.equipment_created',
      table: 'equipment',
      recordId: created?.id ?? null,
      after: row,
    });
  }
  revalidatePath('/admin/operations');
  return { ok: true };
}

export async function deleteEquipment(slug: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('equipment')
    .select('name, category, status')
    .eq('id', id)
    .eq('gym_id', gym.id)
    .maybeSingle();
  const { error } = await supabase.from('equipment').delete().eq('id', id).eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.equipment_deleted',
    table: 'equipment',
    recordId: id,
    before: before ?? null,
  });
  revalidatePath('/admin/operations');
  return { ok: true };
}

export async function recordMaintenance(
  slug: string,
  equipmentId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const performed_at = String(formData.get('performed_at') ?? new Date().toISOString().split('T')[0]);
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const next_due = String(formData.get('next_due') ?? '').trim() || null;
  const cost_raw = String(formData.get('cost') ?? '').trim();
  const cost = cost_raw ? Number(cost_raw) : null;

  const supabase = await createClient();
  await supabase.from('equipment_maintenance').insert({
    equipment_id: equipmentId,
    gym_id: gym.id,
    maintenance_type: 'service',
    performed_at,
    notes,
    cost,
    next_due,
  });
  await supabase
    .from('equipment')
    .update({ last_maintenance_date: performed_at, next_maintenance_date: next_due })
    .eq('id', equipmentId)
    .eq('gym_id', gym.id);
  revalidatePath('/admin/operations');
  return { ok: true };
}
