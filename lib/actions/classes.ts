'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff, requireMember } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';

export async function createClassWithSchedule(slug: string, formData: FormData) {
  const { gym } = await requireStaff(slug);
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const category = String(formData.get('category') ?? '').trim() || null;
  const level = String(formData.get('level') ?? '').trim() || null;
  const duration_minutes = Number(formData.get('duration_minutes') ?? 60);
  const max_capacity = Number(formData.get('max_capacity') ?? 20);
  const instructor = String(formData.get('instructor') ?? '').trim() || null;
  const day_of_week = Number(formData.get('day_of_week') ?? 1);
  const start_time = String(formData.get('start_time') ?? '');
  const end_time = String(formData.get('end_time') ?? '');
  const room = String(formData.get('room') ?? '').trim() || null;

  if (!name || !start_time || !end_time) return;

  const supabase = await createClient();
  const dowLabel = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day_of_week] ?? 'monday';

  const { data: cls, error: clsError } = await supabase
    .from('classes')
    .insert({
      gym_id: gym.id,
      name,
      description,
      category,
      level,
      duration_minutes,
      max_capacity,
      instructor,
      day_of_week: dowLabel,
      start_time,
      end_time,
      is_active: true,
    })
    .select('id')
    .maybeSingle();

  if (clsError || !cls) return;

  await supabase.from('class_schedules').insert({
    gym_id: gym.id,
    class_id: cls.id,
    day_of_week,
    start_time,
    end_time,
    room,
    is_active: true,
  });

  revalidatePath('/admin/classes');
  revalidatePath('/classes');
}

export async function deleteClass(slug: string, classId: string) {
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();
  await supabase.from('class_schedules').delete().eq('class_id', classId).eq('gym_id', gym.id);
  await supabase.from('classes').delete().eq('id', classId).eq('gym_id', gym.id);
  revalidatePath('/admin/classes');
  revalidatePath('/classes');
}

export type BookResult =
  | { ok: true; bookingId: string; waitlisted: boolean }
  | { ok: false; error: string };

export async function bookClass(slug: string, scheduleId: string, bookingDate: string): Promise<BookResult> {
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  const { data: schedule } = await supabase
    .from('class_schedules')
    .select('id, class_id, gym_id, classes(max_capacity)')
    .eq('id', scheduleId)
    .eq('gym_id', gym.id)
    .maybeSingle();

  if (!schedule) return { ok: false, error: 'Class not found' };

  const cls = Array.isArray(schedule.classes) ? schedule.classes[0] : schedule.classes;
  const capacity = cls?.max_capacity ?? null;

  const { data: existing } = await supabase
    .from('class_bookings')
    .select('id, status')
    .eq('class_schedule_id', scheduleId)
    .eq('member_id', user.id)
    .eq('booking_date', bookingDate)
    .maybeSingle();

  if (existing && existing.status !== 'cancelled') {
    return { ok: false, error: 'You already have a spot for this class' };
  }

  // Count confirmed bookings to decide booked vs waitlisted.
  const { count: bookedCount } = await supabase
    .from('class_bookings')
    .select('*', { count: 'exact', head: true })
    .eq('class_schedule_id', scheduleId)
    .eq('booking_date', bookingDate)
    .eq('status', 'booked');

  const isFull = capacity != null && (bookedCount ?? 0) >= capacity;
  const status = isFull ? 'waitlisted' : 'booked';

  if (existing) {
    // Re-activate a previously cancelled booking.
    const { error } = await supabase
      .from('class_bookings')
      .update({ status, booked_at: new Date().toISOString(), cancelled_at: null, cancellation_reason: null })
      .eq('id', existing.id)
      .eq('member_id', user.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/classes');
    return { ok: true, bookingId: existing.id, waitlisted: isFull };
  }

  const { data: booking, error } = await supabase
    .from('class_bookings')
    .insert({
      gym_id: gym.id,
      member_id: user.id,
      class_id: schedule.class_id,
      class_schedule_id: scheduleId,
      booking_date: bookingDate,
      booked_at: new Date().toISOString(),
      status,
    })
    .select('id')
    .maybeSingle();

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking failed' };
  revalidatePath('/classes');
  return { ok: true, bookingId: booking.id, waitlisted: isFull };
}

export async function cancelBooking(slug: string, bookingId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const supabase = await createClient();

  // Read the booking first so we can promote the waitlist if a confirmed spot frees up.
  const { data: target } = await supabase
    .from('class_bookings')
    .select('id, status, class_schedule_id, booking_date, gym_id')
    .eq('id', bookingId)
    .eq('member_id', user.id)
    .maybeSingle();

  const { error } = await supabase
    .from('class_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('member_id', user.id);
  if (error) return { ok: false, error: error.message };

  // A confirmed seat opened up — promote the oldest waitlisted member.
  // Uses the service-role client because RLS scopes member updates to their own rows.
  if (target?.status === 'booked' && target.class_schedule_id && target.booking_date && target.gym_id) {
    try {
      const admin = createAdminClient();
      const { data: next } = await admin
        .from('class_bookings')
        .select('id')
        .eq('gym_id', target.gym_id)
        .eq('class_schedule_id', target.class_schedule_id)
        .eq('booking_date', target.booking_date)
        .eq('status', 'waitlisted')
        .order('booked_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) {
        await admin.from('class_bookings').update({ status: 'booked' }).eq('id', next.id).eq('gym_id', target.gym_id);
      }
    } catch {
      // Promotion is best-effort; the cancellation itself already succeeded.
    }
  }

  revalidatePath('/classes');
  return { ok: true };
}
