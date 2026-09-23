import Link from 'next/link';
import { CalendarDays, Ticket, Gauge, Hourglass, CalendarX, Plus } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watNow } from '@/lib/format';
import { rosterSessionDate } from '@/lib/class-dates';

export const metadata = { title: 'Classes' };

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function splitTime(t: string): { hm: string; ap: string } {
  const [h, m = '00'] = (t ?? '00:00').split(':');
  let hh = parseInt(h, 10);
  if (Number.isNaN(hh)) hh = 0; // malformed start_time → don't render "NaN:00 PM"
  const ap = hh < 12 ? 'AM' : 'PM'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

export default async function AdminClasses({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { gym, role } = await requireStaff();
  const canManage = (MANAGER_ROLES as readonly string[]).includes(role);
  const sp = await searchParams;
  // WAT wall-clock via getUTC*: the server runs in UTC, which put 00:00–01:00
  // WAT on the previous day.
  const today = watNow();
  const todayDow = today.getUTCDay();
  const reqDow = Number(sp.d);
  const selDow = sp.d != null && Number.isInteger(reqDow) && reqDow >= 0 && reqDow <= 6 ? reqDow : todayDow;
  // This week's date for each weekday (Mon-anchored), shown big in the day cards
  // like revamp/admin-classes.html ("MON 26 · 4 classes").
  const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - ((todayDow + 6) % 7));
  const domByDow = new Map<number, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
    domByDow.set(d.getUTCDay(), d.getUTCDate());
  }

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, room, class_id, classes(name, instructor, max_capacity)')
    .eq('gym_id', gym.id).eq('is_active', true)
    .order('start_time', { ascending: true });

  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const { data: bookings } = scheduleIds.length
    ? await supabase.from('class_bookings').select('class_schedule_id, status, booking_date').eq('gym_id', gym.id).neq('status', 'cancelled').in('class_schedule_id', scheduleIds).gte('booking_date', today.toISOString().slice(0, 10))
    : { data: [] as { class_schedule_id: string | null; status: string | null; booking_date: string | null }[] };
  // Only each slot's current session counts. A booking row is reused week to
  // week, so a stale 'booked' row from a past week would otherwise fill today.
  const sessionBySchedule = new Map((schedules ?? []).map((s) => [s.id, rosterSessionDate(s.day_of_week, null, today)]));
  const current = (bookings ?? []).filter((b) => b.class_schedule_id && b.booking_date === sessionBySchedule.get(b.class_schedule_id));
  // Confirmed seats fill the bar / fill-rate; waitlisted rows are tracked apart.
  const booked = current.filter((b) => b.status !== 'waitlisted');
  const waitlistCount = current.filter((b) => b.status === 'waitlisted').length;
  const bookedBy = new Map<string, number>();
  for (const b of booked) if (b.class_schedule_id) bookedBy.set(b.class_schedule_id, (bookedBy.get(b.class_schedule_id) ?? 0) + 1);

  const countByDow = new Map<number, number>();
  for (const s of schedules ?? []) countByDow.set(s.day_of_week, (countByDow.get(s.day_of_week) ?? 0) + 1);
  const daySlots = (schedules ?? []).filter((s) => s.day_of_week === selDow);

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

  // Mon-anchored display order.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <>
      <div className="page-h">
        <div><h1>Classes</h1><p>{totalSessions} session{totalSessions === 1 ? '' : 's'} this week · {totalBookings} booking{totalBookings === 1 ? '' : 's'} · {avgFill}% average fill</p></div>
        {canManage && (
          <Link href="/admin/classes/new" className="gf-btn gf-btn-primary gf-btn-sm" style={{ textDecoration: 'none' }}><Plus strokeWidth={1.9} size={15} /> Add class</Link>
        )}
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="days">
        {order.map((dow) => (
          <Link key={dow} href={`/admin/classes?d=${dow}`} className={`day${selDow === dow ? ' on' : ''}`}>
            <div className="dn">{DOW[dow]}</div><div className="dd">{domByDow.get(dow)}</div><div className="dc">{countByDow.get(dow) ?? 0} class{(countByDow.get(dow) ?? 0) === 1 ? '' : 'es'}</div>
          </Link>
        ))}
      </div>

      {daySlots.length === 0 ? (
        <div className="panel"><div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No classes that day</h3><p>Add a class to publish it on the timetable.</p></div></div>
      ) : (
        <div className="cls-list">
          {daySlots.map((s) => {
            const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
            const cap = c?.max_capacity ?? 0;
            const booked = bookedBy.get(s.id) ?? 0;
            const pct = cap > 0 ? Math.min(100, Math.round((booked / cap) * 100)) : 0;
            const { hm, ap } = splitTime(s.start_time);
            return (
              <Link className="clx" key={s.id} href={`/admin/classes/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="tm"><b>{hm}</b><span>{ap}</span></div>
                <div className="info"><strong>{c?.name ?? 'Class'}</strong><small>{c?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small></div>
                <div className="cap">
                  <div className="lbl"><span>{booked}/{cap || '—'} booked</span><span>{cap > 0 ? `${pct}%` : ''}</span></div>
                  <div className="track"><div className={`fill${pct >= 90 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
