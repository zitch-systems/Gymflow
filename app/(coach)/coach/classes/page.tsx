import { CalendarX } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watNow } from '@/lib/format';
import { rosterSessionDate } from '@/lib/class-dates';

export const metadata = { title: 'Classes · Instructor' };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function splitTime(t: string): { hm: string; ap: string } {
  const [h, m = '00'] = (t ?? '00:00').split(':');
  const hh = parseInt(h, 10); const ap = hh < 12 ? 'AM' : 'PM'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

export default async function CoachClasses() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, room, class_id, classes(name, max_capacity)')
    .eq('gym_id', gym.id).eq('instructor_id', user.id).eq('is_active', true)
    .order('day_of_week', { ascending: true }).order('start_time', { ascending: true });

  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const now = watNow();
  const { data: bookings } = scheduleIds.length
    ? await supabase.from('class_bookings').select('class_schedule_id, booking_date').eq('gym_id', gym.id).in('status', ['booked', 'attended', 'no_show']).in('class_schedule_id', scheduleIds).gte('booking_date', now.toISOString().slice(0, 10))
    : { data: [] as { class_schedule_id: string | null; booking_date: string | null }[] };
  // Seats taken in each slot's current session only — booking rows are reused
  // week to week, so older rows are not this week's seats.
  const sessionBySchedule = new Map((schedules ?? []).map((s) => [s.id, rosterSessionDate(s.day_of_week, null, now)]));
  const bookedBy = new Map<string, number>();
  for (const b of bookings ?? []) {
    if (b.class_schedule_id && b.booking_date === sessionBySchedule.get(b.class_schedule_id)) {
      bookedBy.set(b.class_schedule_id, (bookedBy.get(b.class_schedule_id) ?? 0) + 1);
    }
  }

  const rows = schedules ?? [];

  return (
    <>
      <div className="hdr"><h1>Classes</h1><p>Your teaching schedule · {rows.length} recurring session{rows.length === 1 ? '' : 's'}</p></div>
      <div className="panel">
        <div className="panel-h"><div><h3>This week</h3><div className="sub">Recurring sessions you teach</div></div></div>
        {rows.length === 0 ? (
          <div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No classes assigned</h3><p>Classes you teach will appear here once scheduled.</p></div>
        ) : (
          <div className="tl">
            {rows.map((s) => {
              const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
              const cap = c?.max_capacity ?? 0;
              const booked = bookedBy.get(s.id) ?? 0;
              const { hm } = splitTime(s.start_time);
              const full = cap > 0 && booked >= cap;
              return (
                <div className="tl-row" key={s.id}>
                  <div className="tl-time"><b>{hm}</b><span>{DOW[s.day_of_week] ?? ''}</span></div>
                  <div className="tl-card">
                    <div className="info"><strong>{c?.name ?? 'Class'}</strong><small>{s.room ?? '—'} · {booked}/{cap || '—'} booked</small></div>
                    <span className={`gf-badge ${full ? 'gf-badge-warning' : 'gf-badge-neutral'}`}>{cap > 0 ? (full ? 'Full' : `${cap - booked} left`) : 'Open'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
