'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export type FState = { ok: boolean; error: string | null };

// equipment.status is free text the Facility page maps to OK/Service/Down.
const EQUIPMENT_STATUS = new Set(['operational', 'maintenance', 'broken']);
// Matches the expense_category enum labels in the DB.
export const EXPENSE_CATEGORIES = ['utilities', 'maintenance', 'supplies', 'salaries', 'rent', 'marketing', 'equipment', 'other'] as const;

// Create or edit a piece of equipment (owner/manager/staff via the
// equipment_staff_write RLS policy). Redirects back to the Facility page.
export async function saveEquipment(_prev: FState, fd: FormData): Promise<FState> {
  const id = String(fd.get('id') ?? '') || null;
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Equipment name is required.' };
  let status = String(fd.get('status') ?? 'operational');
  if (!EQUIPMENT_STATUS.has(status)) status = 'operational';
  const priceRaw = fd.get('purchase_price');
  const row = {
    name,
    category: String(fd.get('category') ?? '').trim() || null,
    location: String(fd.get('location') ?? '').trim() || null,
    status,
    serial_number: String(fd.get('serial_number') ?? '').trim() || null,
    vendor: String(fd.get('vendor') ?? '').trim() || null,
    purchase_date: String(fd.get('purchase_date') ?? '') || null,
    purchase_price: priceRaw && Number(priceRaw) > 0 ? Number(priceRaw) : null,
    last_maintenance_date: String(fd.get('last_maintenance_date') ?? '') || null,
    next_maintenance_date: String(fd.get('next_maintenance_date') ?? '') || null,
    maintenance_notes: String(fd.get('maintenance_notes') ?? '').trim() || null,
  };
  try {
    const { user, gym } = await requireStaff();
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from('equipment').update(row).eq('id', id).eq('gym_id', gym.id)
      : await supabase.from('equipment').insert({ gym_id: gym.id, ...row });
    if (error) return { ok: false, error: error.message };
    logAudit({ action: id ? 'equipment_updated' : 'equipment_created', table: 'equipment', actorId: user.id, gymId: gym.id, recordId: id, values: { name, status } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/operations');
}

// Delete a piece of equipment.
export async function deleteEquipment(_prev: FState, fd: FormData): Promise<FState> {
  const id = String(fd.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing equipment id.' };
  try {
    const { user, gym } = await requireStaff();
    const supabase = await createClient();
    const { error } = await supabase.from('equipment').delete().eq('id', id).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'equipment_deleted', table: 'equipment', actorId: user.id, gymId: gym.id, recordId: id });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/operations');
}

// Log a facility expense (inline form on the Facility page).
export async function logExpense(_prev: FState, fd: FormData): Promise<FState> {
  const category = String(fd.get('category') ?? 'other');
  const amount = Number(fd.get('amount') ?? 0);
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: 'Choose a valid category.' };
  if (!amount || amount <= 0) return { ok: false, error: 'Enter a valid amount.' };
  try {
    const { user, gym } = await requireStaff();
    const supabase = await createClient();
    const { error } = await supabase.from('expenses').insert({
      gym_id: gym.id,
      category,
      amount,
      description: String(fd.get('description') ?? '').trim() || null,
      expense_date: String(fd.get('expense_date') ?? '') || new Date().toISOString().slice(0, 10),
      created_by: user.id,
    });
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'expense_logged', table: 'expenses', actorId: user.id, gymId: gym.id, values: { category, amount } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath('/admin/operations');
  return { ok: true, error: null };
}
