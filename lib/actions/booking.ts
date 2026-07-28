'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { watNow, firstName, fmtDate, fmt12Hr } from '@/lib/format';
import { GYM_EMAIL_COLUMNS, type EmailGym } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, classBooked, classPromoted, classWaitlisted } from '@/lib/email/templates/member';

export type BookState = { ok: boolean; error: string | null; message?: string; waitlisted?: boolean };

// Service-role client for occupancy counts + waitlist promotion: a member's RLS
// only exposes their own bookings, so counting the seats taken by OTHER members
// (and promoting another member off the waitlist) must bypass RLS. Returns null
// when the key isn't configured, so booking still works (without caps) locally.
function adminOrNull() {
  try { return createAdminClient(); } catch { return null; }
}

// PostgREST hands back a to-one embed as an object, but the generated types
// model some of them as an array — and a wrong guess here is a class name that
// silently renders as "Class" in a member's inbox.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
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
    // room + the class name/instructor ride along for the confirmation email:
    // "you're booked in" without saying what, when or where is a notification
    // the member has to open the app to act on.
    const { data: sched } = await supabase
      .from('class_schedules').select('id, class_id, day_of_week, start_time, room, classes(name, instructor, max_capacity)')
      .eq('id', scheduleId).eq('gym_id', gym.id).maybeSingle();
    if (!sched) return { ok: false, error: 'Class not found.' };
    const cls = one(sched.classes);
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

    // Same fact, out of the app. Best-effort: the seat is already held and a
    // mail failure must not tell the member their booking didn't work.
    try {
      if (process.env.RESEND_API_KEY) {
        const { data: me } = await supabase
          .from('profiles').select('email, full_name, notification_email').eq('id', user.id).maybeSingle();
        const email = (me?.email ?? '').trim();
        if (email) {
          // Their place in the queue, when the service-role client is there to
          // see other members' rows. The row written above is the newest
          // waitlisted one for this occurrence, so the total IS the place.
          let position: number | null = null;
          if (waitlisted) {
            const counter = adminOrNull();
            if (counter) {
              const { count } = await counter
                .from('class_bookings').select('id', { count: 'exact', head: true })
                .eq('gym_id', gym.id).eq('class_schedule_id', scheduleId)
                .eq('booking_date', bookingDate).eq('status', 'waitlisted');
              position = count ?? null;
            }
          }
          const facts = {
            gymName: gym.name,
            firstName: firstName(me?.full_name),
            className: cls?.name ?? 'Class',
            date: fmtDate(bookingDate),
            time: fmt12Hr(sched.start_time),
            instructor: cls?.instructor ?? null,
            location: sched.room ?? null,
            classUrl: memberAppUrl(gym, '/classes'),
          };
          const spec = waitlisted ? MEMBER_TEMPLATES.classWaitlisted : MEMBER_TEMPLATES.classBooked;
          await sendGymEmail({
            gym,
            to: { email, fullName: me?.full_name ?? null, wantsEmail: me?.notification_email !== false },
            template: spec.template,
            category: spec.category,
            ...(waitlisted ? classWaitlisted({ ...facts, position }) : classBooked(facts)),
          });
        }
      }
    } catch { /* bonus channel */ }

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
    // which occurrence) before we cancel it. The embeds carry what the promotion
    // email needs — the gym's branding and the class facts. Freeing this seat is
    // the only chance to load them: cancelling doesn't tell us who gets promoted,
    // and the promoted member's own gym row is outside this member's RLS.
    const { data: row } = await supabase.from('class_bookings')
      .select(`id, status, gym_id, class_schedule_id, booking_date, gyms(${GYM_EMAIL_COLUMNS}), class_schedules(start_time, room, classes(name, instructor))`)
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
        // profiles rides along so the promotion email has an address without a
        // second service-role round-trip.
        const { data: next } = await admin.from('class_bookings')
          .select('id, member_id, profiles(email, full_name, notification_email)')
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
            // The most time-critical mail on the platform. This member last heard
            // "you're on the waitlist", has planned their day around not going,
            // and the in-app row only reaches them if they happen to open the
            // app before the class starts. Best-effort — the promotion itself is
            // already committed, and this member's cancellation must not fail
            // because someone else's mail did.
            try {
              if (process.env.RESEND_API_KEY) {
                const promoted = one(next.profiles);
                // gyms.brand_color and the notif_* switches postdate
                // lib/database.types.ts, so the generated select parser rejects
                // an embed naming them. Same cast the other email senders use
                // (lib/actions/reminders.ts, lib/paystack-fulfill.ts).
                const gym = one(row.gyms) as unknown as EmailGym | null;
                const email = (promoted?.email ?? '').trim();
                if (email && gym) {
                  const sched = one(row.class_schedules);
                  const cls = one(sched?.classes);
                  const spec = MEMBER_TEMPLATES.classPromoted;
                  await sendGymEmail({
                    gym,
                    to: { email, fullName: promoted?.full_name ?? null, wantsEmail: promoted?.notification_email !== false },
                    template: spec.template,
                    category: spec.category,
                    ...classPromoted({
                      gymName: (gym.name ?? '').trim() || 'Your gym',
                      firstName: firstName(promoted?.full_name),
                      className: cls?.name ?? 'Class',
                      date: fmtDate(row.booking_date),
                      time: sched?.start_time ? fmt12Hr(sched.start_time) : '',
                      instructor: cls?.instructor ?? null,
                      location: sched?.room ?? null,
                      classUrl: memberAppUrl(gym, '/classes'),
                    }),
                  });
                }
              }
            } catch { /* bonus channel */ }
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
