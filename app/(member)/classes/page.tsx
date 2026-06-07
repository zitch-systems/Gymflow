import Link from 'next/link';
import { Bell, CalendarX } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Schedule' };

const SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function splitTime(t: string): { hm: string; ap: string } {
  const [h, m = '00'] = (t ?? '00:00').split(':');
  const hh = parseInt(h, 10); const ap = hh < 12 ? 'AM' : 'PM'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, gym } = await requireMember();
  const sp = await searchParams;
  const tab = sp.tab === 'book' ? 'book' : 'cal';
  const supabase = await createClient();

  const today = new Date();
  const todayDow = today.getDay();
  const mondayOffset = (todayDow + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return { dow: d.getDay(), dom: d.getDate(), label: SHORT[d.getDay()], isToday: d.toDateString() === today.toDateString() };
  });

  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, room, class_id, classes(name, instructor, max_capacity)')
    .eq('gym_id', gym.id).eq('is_active', true)
    .order('start_time', { ascending: true });
  const hasOnDow = new Set((schedules ?? []).map((s) => s.day_of_week));
  const todaySlots = (schedules ?? []).filter((s) => s.day_of_week === todayDow);

  const { data: bookings } = await supabase
    .from('class_bookings')
    .select('id, booking_date, status, class_schedule_id, classes:class_schedules(start_time, room, class_id)')
    .eq('member_id', user.id).neq('status', 'cancelled')
    .order('booking_date', { ascending: true }).limit(30);

  const dowAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][todayDow];

  return (
    <section className="view on" data-v="schedule">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <strong className="htitle">Schedule</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications"><Bell strokeWidth={1.9} /></Link>
      </div>

      <div className="segtabs">
        <Link href="/classes" className={tab === 'cal' ? 'on' : undefined} style={{ textDecoration: 'none' }}>Schedule</Link>
        <Link href="/classes?tab=book" className={tab === 'book' ? 'on' : undefined} style={{ textDecoration: 'none' }}>My bookings</Link>
      </div>

      {tab === 'cal' ? (
        <div>
          <div className="calstrip">
            {week.map((d, i) => (
              <div key={i} className={`cday${d.isToday ? ' on' : ''}`}>
                <span>{d.label}</span><b>{d.dom}</b><span className={`mk${hasOnDow.has(d.dow) ? '' : ' ghost'}`} />
              </div>
            ))}
          </div>
          <div className="day-label">Today · {dowAbbr} {today.getDate()}</div>
          {todaySlots.length === 0 ? (
            <div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No classes today</h3><p>Check another day or back later.</p></div>
          ) : (
            <div className="cls-list">
              {todaySlots.map((s) => {
                const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                const { hm, ap } = splitTime(s.start_time);
                return (
                  <div key={s.id} className="cls-card">
                    <div className="tm"><b>{hm}</b><span>{ap}</span></div>
                    <div className="info"><strong>{c?.name ?? 'Class'}</strong><small>{c?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        (bookings ?? []).length === 0 ? (
          <div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No bookings yet</h3><p>Book a class from the schedule tab.</p></div>
        ) : (
          <div className="cls-list">
            {(bookings ?? []).map((b) => {
              const sch = Array.isArray(b.classes) ? b.classes[0] : b.classes;
              const d = b.booking_date ? new Date(b.booking_date) : null;
              const t = sch?.start_time ? splitTime(sch.start_time) : null;
              return (
                <div key={b.id} className="bkg">
                  <div className="date"><b>{d ? d.getDate() : '—'}</b><span>{d ? SHORT[d.getDay()] : ''}</span></div>
                  <div className="m"><strong>Class</strong><small>{t ? `${t.hm} ${t.ap}` : ''}{sch?.room ? ` · ${sch.room}` : ''}</small></div>
                  <span className={`gf-badge ${b.status === 'waitlisted' ? 'gf-badge-warning' : 'gf-badge-success'}`}>{b.status === 'waitlisted' ? 'Waitlist' : 'Booked'}</span>
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
