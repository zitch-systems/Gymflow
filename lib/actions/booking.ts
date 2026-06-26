'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type BookState = { ok: boolean; error: string | null };

// Next calendar date (YYYY-MM-DD) on or after today matching a weekday (0=Sun).
function nextDateForDow(dow: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const diff = (((dow - d.getDay()) % 7) + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function bookClass(_prev: BookState, formData: FormData): Promise<BookState> {
  const scheduleId = String(formData.get('scheduleId') ?? '');
  if (!scheduleId) return { ok: false, error: 'Missing class.' };
  try {
    const { user, gym } = await requireMember();
    const supabase = await createClient();
    const { data: sched } = await supabase
      .from('class_schedules').select('id, class_id, day_of_week')
      .eq('id', scheduleId).eq('gym_id', gym.id).maybeSingle();
    if (!sched) return { ok: false, error: 'Class not found.' };

    const bookingDate = nextDateForDow(sched.day_of_week);
    // A unique constraint covers (gym_id, class_schedule_id, member_id) regardless
    // of date/status, so a prior (possibly cancelled) row already exists for repeat
    // bookings. Look it up by that key and re-activate it rather than inserting a dup.
    const { data: existing } = await supabase
      .from('class_bookings').select('id, status')
      .eq('gym_id', gym.id).eq('class_schedule_id', scheduleId).eq('member_id', user.id)
      .maybeSingle();
    if (existing && existing.status !== 'cancelled' && existing.status !== 'no_show') {
      return { ok: true, error: null }; // already booked
    }

    const { error } = existing
      ? await supabase.from('class_bookings')
          .update({ status: 'booked', booking_date: bookingDate, booked_at: new Date().toISOString(), cancelled_at: null })
          .eq('id', existing.id)
      : await supabase.from('class_bookings').insert({
          gym_id: gym.id, class_schedule_id: scheduleId, class_id: sched.class_id, member_id: user.id,
          status: 'booked', booking_date: bookingDate, booked_at: new Date().toISOString(),
        });
    if (error) return { ok: false, error: error.message };
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gym.id, user_id: user.id, type: 'class', channel: 'in_app',
      title: 'Class booked', body: `You're booked in for ${bookingDate}.`,
    });
    if (nErr) console.warn(`[booking] notification failed: ${nErr.message}`); // booking itself succeeded
    revalidatePath('/classes'); revalidatePath('/dashboard');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cancelBooking(_prev: BookState, formData: FormData): Promise<BookState> {
  const bookingId = String(formData.get('bookingId') ?? '');
  if (!bookingId) return { ok: false, error: 'Missing booking.' };
  try {
    const { user } = await requireMember();
    const supabase = await createClient();
    const { error } = await supabase.from('class_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId).eq('member_id', user.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/classes'); revalidatePath('/dashboard');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
