'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff, MANAGER_ROLES, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { INTERVAL_PRESETS } from '@/lib/plan-duration';
import { gymHasFeature, upgradeMessage } from '@/lib/entitlements';
import { firstName, fmt12Hr, fmtDate, watDateISO } from '@/lib/format';
import { inSlices } from '@/lib/notify';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, classCancelled } from '@/lib/email/templates/member';

export type CState = { ok: boolean; error: string | null; message?: string };

type Sb = Awaited<ReturnType<typeof createClient>>;

// Resolve the plan form's billing period into stored columns. duration_days is
// the source of truth for daily/weekly; duration_months (NOT NULL) carries the
// rest and stays at 1 as a harmless placeholder for day-based plans.
function durationFromForm(fd: FormData): { duration_days: number | null; duration_months: number } {
  const interval = String(fd.get('interval') ?? 'monthly');
  const preset = INTERVAL_PRESETS.find((p) => p.value === interval);
  if (preset) return { duration_days: preset.days, duration_months: preset.months ?? 1 };
  const count = Math.max(1, Math.floor(Number(fd.get('custom_count') ?? 1)) || 1);
  return String(fd.get('custom_unit') ?? 'months') === 'days'
    ? { duration_days: count, duration_months: 1 }
    : { duration_days: null, duration_months: count };
}

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
  const { duration_days, duration_months } = durationFromForm(formData);
  const isActive = formData.get('is_active') === 'on';
  if (!name) return { ok: false, error: 'Plan name is required.' };
  if (!price || price < 0) return { ok: false, error: 'Enter a valid price.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from('membership_plans')
        .update({ name, price, duration_days, duration_months, is_active: isActive }).eq('id', id).eq('gym_id', gym.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from('membership_plans')
        .insert({ gym_id: gym.id, name, price, duration_days, duration_months, currency: 'NGN', is_active: isActive });
      if (error) return { ok: false, error: error.message };
    }
    logAudit({ action: id ? 'plan_updated' : 'plan_created', table: 'membership_plans', actorId: user.id, gymId: gym.id, recordId: id, values: { name, price, duration_days, duration_months } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/pricing');
}

// #4 — create a class + its weekly schedule (owner/manager via RLS). The class
// can run on several days at the same time slot: the form posts one `day_<n>`
// checkbox per selected weekday, and we write one class_schedules row per day.
export async function createClass(_prev: CState, formData: FormData): Promise<CState> {
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const capacity = Number(formData.get('max_capacity') ?? 0) || null;
  const duration = Number(formData.get('duration_minutes') ?? 0) || null;
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const room = String(formData.get('room') ?? '').trim() || null;
  // Collect every ticked weekday (day_0 … day_6). Fall back to a single
  // day_of_week field for backward compatibility with any old form.
  const days: number[] = [];
  for (let d = 0; d <= 6; d++) if (formData.get(`day_${d}`) === 'on') days.push(d);
  if (days.length === 0) {
    const single = Number(formData.get('day_of_week') ?? -1);
    if (!Number.isNaN(single) && single >= 0 && single <= 6) days.push(single);
  }
  if (!name) return { ok: false, error: 'Class name is required.' };
  if (days.length === 0) return { ok: false, error: 'Choose at least one day of the week.' };
  if (!startTime || !endTime) return { ok: false, error: 'Set a start and end time.' };
  if (endTime <= startTime) return { ok: false, error: 'End time must be after the start time.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    // Tier gate: class scheduling is Growth+ (the pricing matrix the billing
    // page displays — this is where it's actually enforced).
    if (!gymHasFeature(gym, 'class_scheduling')) return { ok: false, error: upgradeMessage('class_scheduling') };
    const supabase = await createClient();
    const classId = (globalThis.crypto as Crypto).randomUUID();
    const { error: cErr } = await supabase.from('classes')
      .insert({ id: classId, gym_id: gym.id, name, category, max_capacity: capacity, duration_minutes: duration, is_active: true });
    if (cErr) return { ok: false, error: cErr.message };
    const rows = days.map((day_of_week) => ({ gym_id: gym.id, class_id: classId, day_of_week, start_time: startTime, end_time: endTime, room, is_active: true }));
    const { error: sErr } = await supabase.from('class_schedules').insert(rows);
    if (sErr) return { ok: false, error: sErr.message };
    logAudit({ action: 'class_created', table: 'classes', actorId: user.id, gymId: gym.id, recordId: classId, values: { name, days, startTime } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/classes');
}

// #4 — edit a class + its weekly schedule (owner/manager via RLS).
export async function updateClass(_prev: CState, formData: FormData): Promise<CState> {
  const classId = String(formData.get('class_id') ?? '');
  const scheduleId = String(formData.get('schedule_id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const capacity = Number(formData.get('max_capacity') ?? 0) || null;
  const duration = Number(formData.get('duration_minutes') ?? 0) || null;
  const dow = Number(formData.get('day_of_week') ?? -1);
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const room = String(formData.get('room') ?? '').trim() || null;
  if (!classId) return { ok: false, error: 'Missing class.' };
  if (!name) return { ok: false, error: 'Class name is required.' };
  if (Number.isNaN(dow) || dow < 0 || dow > 6) return { ok: false, error: 'Choose a day of week.' };
  if (!startTime || !endTime) return { ok: false, error: 'Set a start and end time.' };
  if (endTime <= startTime) return { ok: false, error: 'End time must be after the start time.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    if (!gymHasFeature(gym, 'class_scheduling')) return { ok: false, error: upgradeMessage('class_scheduling') };
    const supabase = await createClient();
    const { error: cErr } = await supabase.from('classes')
      .update({ name, category, max_capacity: capacity, duration_minutes: duration }).eq('id', classId).eq('gym_id', gym.id);
    if (cErr) return { ok: false, error: cErr.message };
    if (scheduleId) {
      const { error: sErr } = await supabase.from('class_schedules')
        .update({ day_of_week: dow, start_time: startTime, end_time: endTime, room }).eq('id', scheduleId).eq('gym_id', gym.id);
      if (sErr) return { ok: false, error: sErr.message };
    } else {
      const { error: sErr } = await supabase.from('class_schedules')
        .insert({ gym_id: gym.id, class_id: classId, day_of_week: dow, start_time: startTime, end_time: endTime, room, is_active: true });
      if (sErr) return { ok: false, error: sErr.message };
    }
    logAudit({ action: 'class_updated', table: 'classes', actorId: user.id, gymId: gym.id, recordId: classId, values: { name, dow, startTime } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/classes');
}

/** One member with a live seat on a class that is about to be deleted. */
type CancelledSeat = {
  email: string;
  fullName: string | null;
  wantsEmail: boolean;
  className: string;
  instructor: string | null;
  /** booking_date of the occurrence they hold. */
  date: string;
  /** Schedule start_time (24h), or null if the row went missing. */
  time: string | null;
  location: string | null;
};

/**
 * Everyone still holding a seat on this class, with the facts their
 * cancellation email needs.
 *
 * MUST be called BEFORE the schedules are deleted:
 * class_bookings.class_schedule_id is ON DELETE CASCADE, so deleting them takes
 * every booking with it and the recipient list stops existing.
 *
 * Only 'booked' rows and only future occurrences — a waitlist place isn't a
 * booking to release, and "your class is cancelled" about last Tuesday's session
 * is noise. A member booked onto two weekdays of the same class gets one email
 * per cancelled session, because that is two sessions they planned around.
 */
async function cancelledSeats(supabase: Sb, gymId: string, classId: string): Promise<CancelledSeat[]> {
  // Three reads to build a list nobody will be mailed from is not worth paying
  // for on a delete.
  if (!process.env.RESEND_API_KEY) return [];
  const [{ data: cls }, { data: scheds }] = await Promise.all([
    supabase.from('classes').select('name, instructor').eq('id', classId).eq('gym_id', gymId).maybeSingle(),
    supabase.from('class_schedules').select('id, start_time, room').eq('class_id', classId).eq('gym_id', gymId),
  ]);
  const schedById = new Map((scheds ?? []).map((s) => [s.id, s]));
  if (schedById.size === 0) return [];

  // Keyed on the schedule ids rather than class_bookings.class_id: that column
  // is ON DELETE SET NULL and nullable, and a booking whose class_id was cleared
  // is still a member standing outside a locked studio.
  const { data: bookings } = await supabase
    .from('class_bookings').select('member_id, booking_date, class_schedule_id')
    .eq('gym_id', gymId).in('class_schedule_id', [...schedById.keys()])
    .eq('status', 'booked').gte('booking_date', watDateISO());
  const ids = [...new Set((bookings ?? []).map((b) => b.member_id).filter(Boolean) as string[])];
  if (ids.length === 0) return [];

  const { data: people } = await supabase
    .from('profiles').select('id, email, full_name, notification_email').in('id', ids);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  const seats: CancelledSeat[] = [];
  for (const b of bookings ?? []) {
    const person = b.member_id ? byId.get(b.member_id) : null;
    const email = (person?.email ?? '').trim();
    if (!email || !b.booking_date) continue;
    const sched = b.class_schedule_id ? schedById.get(b.class_schedule_id) : null;
    seats.push({
      email,
      fullName: person?.full_name ?? null,
      wantsEmail: person?.notification_email !== false,
      className: cls?.name ?? 'Class',
      instructor: cls?.instructor ?? null,
      date: b.booking_date,
      time: sched?.start_time ?? null,
      location: sched?.room ?? null,
    });
  }
  return seats;
}

// #4 — remove a class and its schedules (owner/manager via RLS).
export async function deleteClass(_prev: CState, formData: FormData): Promise<CState> {
  const classId = String(formData.get('class_id') ?? '');
  if (!classId) return { ok: false, error: 'Missing class.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();

    // Read the recipients BEFORE anything is deleted. The delete below cascades
    // through class_bookings, so by the time it returns there is no list left to
    // query — which is why deleting a class used to silently strand every member
    // who had booked it.
    //
    // Fail-soft on its own: collecting who to email must never block the delete
    // the staff member actually asked for. If this read throws, we lose the
    // notifications, not the action.
    const seats = await cancelledSeats(supabase, gym.id, classId).catch(() => []);

    await supabase.from('class_schedules').delete().eq('class_id', classId).eq('gym_id', gym.id);
    const { error } = await supabase.from('classes').delete().eq('id', classId).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'class_deleted', table: 'classes', actorId: user.id, gymId: gym.id, recordId: classId });

    // Now tell them. Sliced so a popular class doesn't fire eighty sends at once
    // and time the action out. Best-effort: the class is already gone.
    try {
      const spec = MEMBER_TEMPLATES.classCancelled;
      await inSlices(seats, 5, (seat) => sendGymEmail({
        gym,
        to: { email: seat.email, fullName: seat.fullName, wantsEmail: seat.wantsEmail },
        template: spec.template,
        category: spec.category,
        ...classCancelled({
          gymName: gym.name,
          firstName: firstName(seat.fullName),
          className: seat.className,
          date: fmtDate(seat.date),
          time: seat.time ? fmt12Hr(seat.time) : '',
          instructor: seat.instructor,
          location: seat.location,
          // The delete form gives staff nowhere to write one, and an invented
          // reason on a cancellation is worse than none.
          reason: null,
          classesUrl: memberAppUrl(gym, '/classes'),
        }),
      }));
    } catch { /* bonus channel */ }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect('/admin/classes');
}
