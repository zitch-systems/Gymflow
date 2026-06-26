'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export type FState = { ok: boolean; error: string | null };

// equipment.status — constrained by equipment_status_check to these values;
// the Facility page maps them to OK/Service/Down labels.
const EQUIPMENT_STATUS = new Set(['active', 'maintenance', 'retired']);
// Matches the expense_category enum labels in the DB.
export const EXPENSE_CATEGORIES = ['utilities', 'maintenance', 'supplies', 'salaries', 'rent', 'marketing', 'equipment', 'other'] as const;

// Create or edit a piece of equipment (owner/manager/staff via the
// equipment_staff_write RLS policy). Redirects back to the Facility page.
export async function saveEquipment(_prev: FState, fd: FormData): Promise<FState> {
  const id = String(fd.get('id') ?? '') || null;
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Equipment name is required.' };
  let status = String(fd.get('status') ?? 'active');
  if (!EQUIPMENT_STATUS.has(status)) status = 'active';
  const priceRaw = fd.get('purchase_price');
  const photo = fd.get('photo');
  const removePhoto = fd.get('remove_photo') === 'on';
  // Validate the photo before any DB work (the gym-assets bucket also enforces
  // image/* and a 2 MB cap at the storage layer).
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith('image/')) return { ok: false, error: 'Photo must be an image.' };
    if (photo.size > 2_000_000) return { ok: false, error: 'Photo must be under 2 MB.' };
  }
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

    // Photo upload goes to the per-gym gym-assets bucket; the storage RLS keys
    // off the first path segment (the gym id). A new file replaces the old URL,
    // an explicit "remove" clears it, and otherwise photo_url is left untouched
    // so an edit without a new file keeps the existing image.
    const patch: { photo_url?: string | null } = {};
    if (photo instanceof File && photo.size > 0) {
      const ext = ((photo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
      const path = `${gym.id}/equipment/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('gym-assets').upload(path, photo, { contentType: photo.type, upsert: true });
      if (upErr) return { ok: false, error: upErr.message };
      patch.photo_url = supabase.storage.from('gym-assets').getPublicUrl(path).data.publicUrl;
    } else if (removePhoto) {
      patch.photo_url = null;
    }

    const payload = { ...row, ...patch };
    const { error } = id
      ? await supabase.from('equipment').update(payload).eq('id', id).eq('gym_id', gym.id)
      : await supabase.from('equipment').insert({ gym_id: gym.id, ...payload });
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
