'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff, MANAGER_ROLES, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

export type CState = { ok: boolean; error: string | null; message?: string };

const BOOKING_STATUSES = new Set(['booked', 'attended', 'no_show', 'cancelled', 'waitlisted']);

// #2 — mark class attendance (staff). RLS bookings_staff_update allows it.
export async function setBookingStatus(_prev: CState, formData: FormData): Promise<CState> {
  const bookingId = String(formData.get('bookingId') ?? '');
  const status = String(formData.get('status') ?? '');
  const scheduleId = String(formData.get('scheduleId') ?? '');
  if (!bookingId || !BOOKING_STATUSES.has(status)) return { ok: false, error: 'Invalid request.' };
  try {
    // Admin-console attendance — restrict to admin staff (front desk included),
    // not bare requireStaff() which would also let an instructor mutate bookings
    // here. Coaches mark their own classes' attendance via the /coach surface.
    const { gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('class_bookings').update({ status }).eq('id', bookingId).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    if (scheduleId) revalidatePath(`/admin/classes/${scheduleId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// #4 — create / edit a membership plan (owner/manager via RLS).
export async function savePlan(_prev: CState, formData: FormData): Promise<CState> {
  const id = String(formData.get('id') ?? '') || null;
  const name = String(formData.get('name') ?? '').trim();
  const price = Number(formData.get('price') ?? 0);
  const duration = Number(formData.get('duration_months') ?? 1) || 1;
  const isActive = formData.get('is_active') === 'on';
  if (!name) return { ok: false, error: 'Plan name is required.' };
  if (!price || price < 0) return { ok: false, error: 'Enter a valid price.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from('membership_plans')
        .update({ name, price, duration_months: duration, is_active: isActive }).eq('id', id).eq('gym_id', gym.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from('membership_plans')
        .insert({ gym_id: gym.id, name, price, duration_months: duration, currency: 'NGN', is_active: isActive });
      if (error) return { ok: false, error: error.message };
    }
    logAudit({ action: id ? 'plan_updated' : 'plan_created', table: 'membership_plans', actorId: user.id, gymId: gym.id, recordId: id, values: { name, price, duration } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/pricing');
}

// #4 — create a class + its weekly schedule (owner/manager via RLS).
export async function createClass(_prev: CState, formData: FormData): Promise<CState> {
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const capacity = Number(formData.get('max_capacity') ?? 0) || null;
  const duration = Number(formData.get('duration_minutes') ?? 0) || null;
  const dow = Number(formData.get('day_of_week') ?? -1);
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const room = String(formData.get('room') ?? '').trim() || null;
  if (!name) return { ok: false, error: 'Class name is required.' };
  if (Number.isNaN(dow) || dow < 0 || dow > 6) return { ok: false, error: 'Choose a day of week.' };
  if (!startTime || !endTime) return { ok: false, error: 'Set a start and end time.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const classId = (globalThis.crypto as Crypto).randomUUID();
    const { error: cErr } = await supabase.from('classes')
      .insert({ id: classId, gym_id: gym.id, name, category, max_capacity: capacity, duration_minutes: duration, is_active: true });
    if (cErr) return { ok: false, error: cErr.message };
    const { error: sErr } = await supabase.from('class_schedules')
      .insert({ gym_id: gym.id, class_id: classId, day_of_week: dow, start_time: startTime, end_time: endTime, room, is_active: true });
    if (sErr) return { ok: false, error: sErr.message };
    logAudit({ action: 'class_created', table: 'classes', actorId: user.id, gymId: gym.id, recordId: classId, values: { name, dow, startTime } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/classes');
}
