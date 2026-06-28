'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { watNow } from '@/lib/format';

export type BookState = { ok: boolean; error: string | null; message?: string; waitlisted?: boolean };

// Service-role client for occupancy counts + waitlist promotion: a member's RLS
// only exposes their own bookings, so counting the seats taken by OTHER members
// (and promoting another member off the waitlist) must bypass RLS. Returns null
// when the key isn't configured, so booking still works (without caps) locally.
function adminOrNull() {
  try { return createAdminClient(); } catch { return null; }
}

// Next calendar date (YYYY-MM-DD) on or after today matching a weekday (0=Sun).
// If the slot falls today but its start time has already passed, roll to next
// week so we never book a session that already happened.
function nextDateForDow(dow: number, startTime?: string | null): string {
  // Anchor to WAT wall-clock (getUTC* on a +1h-shifted Date) so the booking date
  // matches the member's local calendar day, not the UTC server day. Using local
  // server time would book the wrong date for late-evening WAT bookings.
  const now = watNow();
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0);
  let diff = (((dow - d.getUTCDay()) % 7) + 7) % 7;
  if (diff === 0 && startTime) {
    const [h, m] = startTime.split(':').map(Number);
    const startMins = (h || 0) * 60 + (m || 0);
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins) diff = 7;
  }
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function bookClass(_prev: BookState, formData: FormData): Promise<BookState> {
  const scheduleId = String(formData.get('scheduleId') ?? '');
  if (!scheduleId) return { ok: false, error: 'Missing class.' };
  try {
    const { user, gym } = await requireMember();
    const supabase = await createClient();
    const { data: sched } = await supabase
      .from('class_schedules').select('id, class_id, day_of_week, start_time, classes(max_capacity)')
      .eq('id', scheduleId).eq('gym_id', gym.id).maybeSingle();
    if (!sched) return { ok: false, error: 'Class not found.' };
    const cls = Array.isArray(sched.classes) ? sched.classes[0] : sched.classes;
    const capacity = Number(cls?.max_capacity ?? 0);

    const bookingDate = nextDateForDow(sched.day_of_week, sched.start_time);
    // A unique constraint covers (gym_id, class_schedule_id, member_id) regardless
    // of date/status, so a prior (possibly cancelled) row already exists for repeat
    // bookings. Look it up by that key and re-activate it rather than inserting a dup.
    const { data: existing } = await supabase
      .from('class_bookings').select('id, status, booking_date')
      .eq('gym_id', gym.id).eq('class_schedule_id', scheduleId).eq('member_id', user.id)
      .maybeSingle();
    // Already holding a spot (or a waitlist place) for this upcoming occurrence?
    // A terminal historical row — attended / no_show / cancelled, or a row for a
    // past date — falls through and gets re-activated for the next date.
    if (existing && (existing.booking_date ?? '') >= bookingDate) {
      if (existing.status === 'booked') return { ok: true, error: null, message: 'You’re already booked in.' };
      if (existing.status === 'waitlisted') return { ok: true, error: null, waitlisted: true, message: 'You’re already on the waitlist.' };
    }

    // Occupancy: count seats taken by OTHER members for this occurrence (admin
    // client bypasses the booking member's RLS). When full, the member joins the
    // waitlist instead of being rejected. (max_capacity 0/null means "no cap".)
    let waitlisted = false;
    if (capacity > 0) {
      const counter = adminOrNull() ?? supabase;
      const { count } = await counter
        .from('class_bookings').select('id', { count: 'exact', head: true })
        .eq('gym_id', gym.id).eq('class_schedule_id', scheduleId)
        .eq('booking_date', bookingDate).eq('status', 'booked')
        .neq('member_id', user.id);
      waitlisted = (count ?? 0) >= capacity;
    }
    const status = waitlisted ? 'waitlisted' : 'booked';

    const { error } = existing
      ? await supabase.from('class_bookings')
          .update({ status, booking_date: bookingDate, booked_at: new Date().toISOString(), cancelled_at: null })
          .eq('id', existing.id)
      : await supabase.from('class_bookings').insert({
          gym_id: gym.id, class_schedule_id: scheduleId, class_id: sched.class_id, member_id: user.id,
          status, booking_date: bookingDate, booked_at: new Date().toISOString(),
        });
    if (error) return { ok: false, error: error.message };

    const body = waitlisted
      ? `This class is full — you’re on the waitlist for ${bookingDate}. We’ll let you know if a spot opens.`
      : `You're booked in for ${bookingDate}.`;
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gym.id, user_id: user.id, type: 'class', channel: 'in_app',
      title: waitlisted ? 'Added to waitlist' : 'Class booked', body,
    });
    if (nErr) console.warn(`[booking] notification failed: ${nErr.message}`); // booking itself succeeded
    revalidatePath('/classes'); revalidatePath('/dashboard');
    return { ok: true, error: null, waitlisted, message: waitlisted ? 'Added to the waitlist.' : 'You’re booked in.' };
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
    // Read the row first so we know whether a real seat is being freed (and for
    // which occurrence) before we cancel it.
    const { data: row } = await supabase.from('class_bookings')
      .select('id, status, gym_id, class_schedule_id, booking_date')
      .eq('id', bookingId).eq('member_id', user.id).maybeSingle();
    if (!row) return { ok: false, error: 'Booking not found.' };

    const { error } = await supabase.from('class_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId).eq('member_id', user.id);
    if (error) return { ok: false, error: error.message };

    // Freeing a confirmed seat promotes the longest-waiting member off the
    // waitlist for the same occurrence (service role: other members' rows are
    // outside this member's RLS).
    if (row.status === 'booked' && row.gym_id && row.class_schedule_id && row.booking_date) {
      const admin = adminOrNull();
      if (admin) {
        const { data: next } = await admin.from('class_bookings')
          .select('id, member_id')
          .eq('gym_id', row.gym_id).eq('class_schedule_id', row.class_schedule_id)
          .eq('booking_date', row.booking_date).eq('status', 'waitlisted')
          .order('booked_at', { ascending: true }).limit(1).maybeSingle();
        if (next) {
          await admin.from('class_bookings').update({ status: 'booked' }).eq('id', next.id);
          if (next.member_id) {
            await admin.from('notifications').insert({
              gym_id: row.gym_id, user_id: next.member_id, type: 'class', channel: 'in_app',
              title: 'A spot opened up', body: `Good news — a spot opened and you’re now booked in for ${row.booking_date}.`,
            });
          }
        }
      }
    }
    revalidatePath('/classes'); revalidatePath('/dashboard');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
