import type { SupabaseClient } from '@supabase/supabase-js';
import { requireWaiverAcceptance } from '@/lib/waiver-core';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/database.types';
import { watNow, firstName, fmtDate, fmt12Hr } from '@/lib/format';
import { nextOccurrenceDate } from '@/lib/class-dates';
import { GYM_EMAIL_COLUMNS, type EmailGym } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, classBooked, classPromoted, classWaitlisted } from '@/lib/email/templates/member';

// Booking a class seat, and giving one back. Shared by the web Server Actions
// (lib/actions/booking.ts, cookie session) and the Android app's
// /api/app/classes endpoint (bearer token) — capacity, waitlisting and
// waitlist promotion have to behave identically whichever door the member came
// through, or two members end up holding the same seat.

/* eslint-disable @typescript-eslint/no-explicit-any */
// See lib/checkin-core.ts for why the client type is loose here.
type Sb = SupabaseClient<any, any, any>;

export type BookState = { ok: boolean; error: string | null; message?: string; waitlisted?: boolean; code?: 'waiver_required' };

// The whole gym row, not a narrowed {id, name}: the confirmation mail is dressed
// in the gym's branding and respects its notification switches, and both live on
// columns a narrow type would drop on the floor.
type GymRow = Database['public']['Tables']['gyms']['Row'];

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

// Which date this slot next runs on. Shared with the class-detail page via
// lib/class-dates.ts — when the two had their own copies they disagreed about a
// slot whose time had passed, and a booked member was shown "Book your spot".
function nextDateForDow(dow: number, startTime?: string | null): string {
  return nextOccurrenceDate(dow, startTime, watNow());
}

export async function bookClassCore(supabase: Sb, memberId: string, gym: GymRow, scheduleId: string): Promise<BookState> {
  if (!scheduleId) return { ok: false, error: 'Missing class.' };
  try {
    await requireWaiverAcceptance(supabase, memberId, gym);
    // room + the class name/instructor ride along for the confirmation email:
    // "you're booked in" without saying what, when or where is a notification
    // the member has to open the app to act on.
    const { data: sched, error: scheduleError } = await supabase
      .from('class_schedules').select('id, class_id, day_of_week, start_time, room, classes(name, instructor)')
      .eq('id', scheduleId).eq('gym_id', gym.id).eq('is_active', true).maybeSingle();
    if (scheduleError) return { ok: false, error: 'Classes could not be loaded. Please try again.' };
    if (!sched) return { ok: false, error: 'Class not found.' };
    const cls = one(sched.classes) as { name?: string | null; instructor?: string | null } | null;

    const bookingDate = nextDateForDow(sched.day_of_week, sched.start_time);
    // Historical and cancelled rows remain immutable. The active-occurrence
    // index makes retries idempotent without rewriting attendance history.
    const activeBooking = () => supabase.from('class_bookings')
      .select('id, status, booking_date')
      .eq('gym_id', gym.id).eq('class_schedule_id', scheduleId).eq('member_id', memberId)
      .eq('booking_date', bookingDate).in('status', ['booked', 'waitlisted']).maybeSingle();
    const alreadyBooked = (status: string): BookState => ({
      ok: true, error: null, waitlisted: status === 'waitlisted',
      message: status === 'waitlisted' ? 'You’re already on the waitlist.' : 'You’re already booked in.',
    });
    const { data: existing, error: existingError } = await activeBooking();
    if (existingError) return { ok: false, error: 'Your bookings could not be loaded. Please try again.' };
    if (existing) return alreadyBooked(existing.status);

    // The database's locked capacity trigger is authoritative. Two members
    // racing for the last seat can both request booked, but one is persisted
    // as waitlisted. Read the returned status before displaying or emailing it.
    const { data: committed, error } = await supabase.from('class_bookings').insert({
      gym_id: gym.id, class_schedule_id: scheduleId, class_id: sched.class_id, member_id: memberId,
      status: 'booked', booking_date: bookingDate, booked_at: new Date().toISOString(),
    }).select('id, status').single();
    if (error) {
      if (error.code === '23505') {
        const { data: concurrent } = await activeBooking();
        if (concurrent) return alreadyBooked(concurrent.status);
      }
      return { ok: false, error: error.message };
    }
    if (!committed) return { ok: false, error: 'Your booking could not be confirmed. Please try again.' };
    const waitlisted = committed.status === 'waitlisted';

    const body = waitlisted
      ? `This class is full — you’re on the waitlist for ${bookingDate}. We’ll let you know if a spot opens.`
      : `You're booked in for ${bookingDate}.`;
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gym.id, user_id: memberId, type: 'class', channel: 'in_app',
      title: waitlisted ? 'Added to waitlist' : 'Class booked', body,
    });
    if (nErr) console.warn(`[booking] notification failed: ${nErr.message}`); // booking itself succeeded

    // Same fact, out of the app. Best-effort: the seat is already held and a
    // mail failure must not tell the member their booking didn't work.
    try {
      if (process.env.RESEND_API_KEY) {
        const { data: me } = await supabase
          .from('profiles').select('email, full_name, notification_email').eq('id', memberId).maybeSingle();
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

    return { ok: true, error: null, waitlisted, message: waitlisted ? 'Added to the waitlist.' : 'You’re booked in.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message, ...((e as { code?: string }).code === 'waiver_required' ? { code: 'waiver_required' as const } : {}) };
  }
}

export async function cancelBookingCore(supabase: Sb, memberId: string, bookingId: string): Promise<BookState> {
  if (!bookingId) return { ok: false, error: 'Missing booking.' };
  try {
    // Read the row first so we know whether a real seat is being freed (and for
    // which occurrence) before we cancel it. The embeds carry what the promotion
    // email needs — the gym's branding and the class facts. Freeing this seat is
    // the only chance to load them: cancelling doesn't tell us who gets promoted,
    // and the promoted member's own gym row is outside this member's RLS.
    const { data: row, error: readError } = await supabase.from('class_bookings')
      .select(`id, status, gym_id, class_schedule_id, booking_date, gyms(${GYM_EMAIL_COLUMNS}), class_schedules(start_time, room, classes(name, instructor))`)
      .eq('id', bookingId).eq('member_id', memberId).maybeSingle();
    if (readError) return { ok: false, error: 'Your booking could not be loaded. Please try again.' };
    if (!row) return { ok: false, error: 'Booking not found.' };

    if (row.status === 'cancelled') return { ok: true, error: null };
    if (row.status !== 'booked' && row.status !== 'waitlisted') return { ok: false, error: 'This booking can no longer be cancelled.' };
    const { data: cancelled, error } = await supabase.from('class_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId).eq('member_id', memberId).eq('status', row.status)
      .select('id').maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!cancelled) return { ok: false, error: 'This booking has changed. Refresh your classes and try again.' };

    // Freeing a confirmed seat promotes the longest-waiting member off the
    // waitlist for the same occurrence (service role: other members' rows are
    // outside this member's RLS).
    if (row.status === 'booked' && row.gym_id && row.class_schedule_id && row.booking_date) {
      const admin = adminOrNull();
      if (admin) {
        // profiles rides along so the promotion email has an address without a
        // second service-role round-trip.
        // Retry a lost compare-and-swap: a second cancellation may promote
        // the same oldest row while this seat still needs its own replacement.
        // Bounded retries avoid keeping a request open under sustained churn.
        let next: any = null;
        let casRow: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data: candidate, error: candidateError } = await admin.from('class_bookings')
            .select('id, member_id, profiles(email, full_name, notification_email)')
            .eq('gym_id', row.gym_id).eq('class_schedule_id', row.class_schedule_id)
            .eq('booking_date', row.booking_date).eq('status', 'waitlisted')
            .order('booked_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
          if (candidateError || !candidate) break;
          const { data: promoted, error: promotionError } = await admin.from('class_bookings')
            .update({ status: 'booked' }).eq('id', candidate.id).eq('status', 'waitlisted')
            .select('id, status').maybeSingle();
          if (promotionError) break;
          if (promoted) { next = candidate; casRow = promoted; break; }
        }
        if (next) {
          if (casRow?.status === 'booked' && next.member_id) {
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
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
