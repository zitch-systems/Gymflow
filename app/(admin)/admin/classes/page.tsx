import Link from 'next/link';
import { CalendarDays, Ticket, Gauge, Hourglass, Plus } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { splitTime } from '@/lib/format';
import { ClassesWeek, type AdminDay, type AdminSlot } from '@/components/admin/classes-week';

export const metadata = { title: 'Classes' };

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// The ?d= day selection is read client-side by ClassesWeek via useSearchParams.
export default async function AdminClasses() {
  const { gym } = await requireStaff();
  const today = new Date();
  const todayDow = today.getDay();
  // This week's date for each weekday (Mon-anchored), shown big in the day cards
  // like revamp/admin-classes.html ("MON 26 · 4 classes").
  const monday = new Date(today); monday.setDate(today.getDate() - ((todayDow + 6) % 7));
  const domByDow = new Map<number, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    domByDow.set(d.getDay(), d.getDate());
  }

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, room, class_id, classes(name, instructor, max_capacity)')
    .eq('gym_id', gym.id).eq('is_active', true)
    .order('start_time', { ascending: true });

  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const { data: bookings } = scheduleIds.length
    ? await supabase.from('class_bookings').select('class_schedule_id, status').eq('gym_id', gym.id).neq('status', 'cancelled').in('class_schedule_id', scheduleIds)
    : { data: [] as { class_schedule_id: string | null; status: string | null }[] };
  // Confirmed seats fill the bar / fill-rate; waitlisted rows are tracked apart.
  const booked = (bookings ?? []).filter((b) => b.status === 'booked');
  const waitlistCount = (bookings ?? []).filter((b) => b.status === 'waitlisted').length;
  const bookedBy = new Map<string, number>();
  for (const b of booked) if (b.class_schedule_id) bookedBy.set(b.class_schedule_id, (bookedBy.get(b.class_schedule_id) ?? 0) + 1);

  const countByDow = new Map<number, number>();
  for (const s of schedules ?? []) countByDow.set(s.day_of_week, (countByDow.get(s.day_of_week) ?? 0) + 1);

  const totalSessions = (schedules ?? []).length;
  const totalBookings = booked.length;
  const caps = (schedules ?? []).map((s) => { const c = Array.isArray(s.classes) ? s.classes[0] : s.classes; return c?.max_capacity ?? 0; });
  const totalCap = caps.reduce((a, b) => a + b, 0);
  const avgFill = totalCap > 0 ? Math.round((totalBookings / totalCap) * 100) : 0;

  const KPIS = [
    { icon: CalendarDays, fg: '#11d18b', bg: '#11d18b1f', val: String(totalSessions), lbl: 'Sessions / week' },
    { icon: Ticket, fg: '#4080ff', bg: '#4080ff1f', val: String(totalBookings), lbl: 'Bookings' },
    { icon: Gauge, fg: '#a8d92e', bg: '#c6f24e1f', val: `${avgFill}%`, lbl: 'Avg fill rate' },
    { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: String(waitlistCount), lbl: 'On waitlists' },
  ];

  // Mon-anchored display order; slots for the whole week go to the client
  // component so day selection is instant local state, not a server round trip.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days: AdminDay[] = order.map((dow) => ({ dow, name: DOW[dow], dom: domByDow.get(dow), count: countByDow.get(dow) ?? 0 }));
  const slots: AdminSlot[] = (schedules ?? []).map((s) => {
    const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    const { hm, ap } = splitTime(s.start_time);
    return {
      id: s.id, dow: s.day_of_week, hm, ap,
      name: c?.name ?? 'Class', instructor: c?.instructor ?? 'TBA', room: s.room ?? null,
      booked: bookedBy.get(s.id) ?? 0, cap: c?.max_capacity ?? 0,
    };
  });

  return (
    <>
      <div className="page-h">
        <div><h1>Classes</h1><p>{totalSessions} session{totalSessions === 1 ? '' : 's'} this week · {totalBookings} booking{totalBookings === 1 ? '' : 's'} · {avgFill}% average fill</p></div>
        <Link href="/admin/classes/new" className="gf-btn gf-btn-primary gf-btn-sm" style={{ textDecoration: 'none' }}><Plus strokeWidth={1.9} size={15} /> Add class</Link>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <ClassesWeek days={days} slots={slots} todayDow={todayDow} />
    </>
  );
}
