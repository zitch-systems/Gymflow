import Link from 'next/link';
import { Bell } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { splitTime } from '@/lib/format';
import { ScheduleView, type BookingRow, type ScheduleDay, type ScheduleSlot } from '@/components/member/schedule-view';

export const metadata = { title: 'Schedule' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Three-letter day names, as in revamp/member.html's calstrip ("MON 9" …).
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Server half of the schedule screen: fetch the whole week + bookings once,
// then hand plain rows to the client ScheduleView — day/tab switching happens
// client-side with zero further round trips.
// searchParams (?d= / ?tab=) are read client-side by ScheduleView via
// useSearchParams; the server render doesn't depend on them.
export default async function SchedulePage() {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const today = new Date();
  const todayDow = today.getDay();
  const todayStr = today.toISOString().slice(0, 10);
  const mondayOffset = (todayDow + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - mondayOffset);

  const [{ data: classes }, { data: schedules }, { data: bookings }, { count: unread }] = await Promise.all([
    supabase.from('classes').select('id, name, instructor, max_capacity').eq('gym_id', gym.id),
    supabase.from('class_schedules').select('id, day_of_week, start_time, room, class_id').eq('gym_id', gym.id).eq('is_active', true).order('start_time', { ascending: true }),
    // Bounded history: everything upcoming plus the last ~90 days. Unbounded,
    // a long-time member's whole booking history would ship in the RSC props
    // on every schedule render.
    supabase.from('class_bookings').select('id, booking_date, status, class_schedule_id, class_id').eq('member_id', user.id).neq('status', 'cancelled')
      .gte('booking_date', new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))
      .order('booking_date', { ascending: true }).limit(200),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
  ]);

  const classMap = new Map((classes ?? []).map((c) => [c.id, c]));
  const schedMap = new Map((schedules ?? []).map((s) => [s.id, s]));
  const hasOnDow = new Set((schedules ?? []).map((s) => s.day_of_week));
  const upcoming = (bookings ?? []).filter((b) => (b.booking_date ?? '') >= todayStr);
  const bookedSet = new Set(upcoming.map((b) => b.class_schedule_id));
  // Days of this week the member has a booking on — the calstrip marks them accent.
  const bookedDows = new Set(upcoming.map((b) => (b.booking_date ? new Date(`${b.booking_date}T00:00:00`).getDay() : -1)));
  const unreadCount = unread ?? 0;

  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const dow = d.getDay();
    return { dow, dom: d.getDate(), label: SHORT[dow], hasClasses: hasOnDow.has(dow), hasBooking: bookedDows.has(dow) };
  });

  const slots: ScheduleSlot[] = (schedules ?? []).map((s) => {
    const c = s.class_id ? classMap.get(s.class_id) : null;
    const { hm, ap } = splitTime(s.start_time);
    return { id: s.id, dow: s.day_of_week, hm, ap, name: c?.name ?? 'Class', instructor: c?.instructor ?? 'TBA', room: s.room ?? null, booked: bookedSet.has(s.id) };
  });

  const bookingRows: BookingRow[] = (bookings ?? []).map((b) => {
    const sch = b.class_schedule_id ? schedMap.get(b.class_schedule_id) : null;
    const c = b.class_id ? classMap.get(b.class_id) : null;
    // Parse as local midnight — bare YYYY-MM-DD parses as UTC and can shift a day.
    const d = b.booking_date ? new Date(`${b.booking_date}T00:00:00`) : null;
    const t = sch?.start_time ? splitTime(sch.start_time) : null;
    return {
      id: b.id, dom: d ? d.getDate() : null, dow3: d ? SHORT[d.getDay()] : '',
      name: c?.name ?? 'Class', time: t ? `${t.hm} ${t.ap}` : '', room: sch?.room ?? null,
      status: b.status ?? '', isUpcoming: (b.booking_date ?? '') >= todayStr,
    };
  });

  return (
    <section className="view on" data-v="schedule">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <strong className="htitle">Schedule</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} />{unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
      </div>
      <ScheduleView days={days} slots={slots} bookings={bookingRows} todayDow={todayDow} />
    </section>
  );
}
