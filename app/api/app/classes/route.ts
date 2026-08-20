import { requireApiMember, json, corsPreflight, readJson, planLocked } from '@/lib/api-app';
import { gymHasFeature } from '@/lib/entitlements';
import { bookClassCore, cancelBookingCore } from '@/lib/booking-core';
import { watDateISO, watNow } from '@/lib/format';
import { nextOccurrenceDate } from '@/lib/class-dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

type ClassRow = { id: string; name: string | null; instructor: string | null; max_capacity: number | null; duration_minutes: number | null; description: string | null };
type ScheduleRow = { id: string; day_of_week: number; start_time: string; room: string | null; class_id: string | null };
type BookingRow = { id: string; booking_date: string | null; status: string | null; class_schedule_id: string | null; class_id: string | null };

// GET /api/app/classes — the gym's weekly timetable plus this member's bookings.
//
// The timetable is small (a gym runs tens of slots, not thousands), so the app
// fetches it whole and slices by day on the device instead of re-querying on
// every tap of the date strip.
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  try {
    const [{ data: classes }, { data: schedules }, { data: bookings }] = await Promise.all([
      supabase.from('classes').select('id, name, instructor, max_capacity, duration_minutes, description').eq('gym_id', gym.id),
      supabase.from('class_schedules').select('id, day_of_week, start_time, room, class_id')
        .eq('gym_id', gym.id).eq('is_active', true).order('start_time', { ascending: true }),
      supabase.from('class_bookings').select('id, booking_date, status, class_schedule_id, class_id')
        .eq('member_id', user.id).neq('status', 'cancelled').order('booking_date', { ascending: true }),
    ]);

    const classMap = new Map(((classes ?? []) as ClassRow[]).map((c) => [c.id, c]));
    const now = watNow();

    return json({
      today: watDateISO(),
      // Each slot carries its class facts inline and the date it next runs on,
      // so the app never has to re-derive "which Tuesday is this?" — that rule
      // lives in lib/class-dates.ts and is shared with the web surfaces.
      schedule: ((schedules ?? []) as ScheduleRow[]).map((s) => {
        const c = s.class_id ? classMap.get(s.class_id) : null;
        return {
          id: s.id,
          class_id: s.class_id,
          day_of_week: s.day_of_week,
          start_time: String(s.start_time).slice(0, 5),
          room: s.room,
          name: c?.name ?? 'Class',
          instructor: c?.instructor ?? null,
          duration_minutes: c?.duration_minutes ?? null,
          capacity: c?.max_capacity ?? null,
          next_date: nextOccurrenceDate(s.day_of_week, s.start_time, now),
        };
      }),
      bookings: ((bookings ?? []) as BookingRow[]).map((b) => {
        const c = b.class_id ? classMap.get(b.class_id) : null;
        const sched = ((schedules ?? []) as ScheduleRow[]).find((s) => s.id === b.class_schedule_id) ?? null;
        return {
          id: b.id,
          class_schedule_id: b.class_schedule_id,
          booking_date: b.booking_date,
          status: b.status,
          name: c?.name ?? 'Class',
          instructor: c?.instructor ?? null,
          room: sched?.room ?? null,
          start_time: sched?.start_time ? String(sched.start_time).slice(0, 5) : null,
          duration_minutes: c?.duration_minutes ?? null,
        };
      }),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// POST /api/app/classes — { action: 'book', schedule_id } | { action: 'cancel', booking_id }.
// Capacity, waitlisting and waitlist promotion come from lib/booking-core.ts,
// shared with the web forms.
export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  const body = await readJson(req);
  const action = String(body.action ?? '');

  try {
    if (action === 'book') {
      // gymHasFeature, NOT gymCanUse: class scheduling was already Growth-only
      // before the Starter repositioning, so legacy_full_access must not widen
      // into it — a legacy Starter gym was never entitled to classes and
      // lib/actions/admin-class.ts already refuses to let it create any.
      // Mirrored in bookClass (lib/actions/booking.ts) so the two doors agree.
      if (!gymHasFeature(gym, 'class_scheduling')) return planLocked(gym.name, 'class booking');
      const res = await bookClassCore(supabase, user.id, gym, String(body.schedule_id ?? ''));
      return res.ok
        ? json({ ok: true, waitlisted: Boolean(res.waitlisted), message: res.message ?? null })
        : json({ ok: false, error: res.error }, 422);
    }

    if (action === 'cancel') {
      // Ungated on purpose: giving a seat back is not consuming the feature, and
      // a member holding a booking made before a plan change must still be able
      // to release it so someone on the waitlist gets it.
      const res = await cancelBookingCore(supabase, user.id, String(body.booking_id ?? ''));
      return res.ok ? json({ ok: true }) : json({ ok: false, error: res.error }, 422);
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
