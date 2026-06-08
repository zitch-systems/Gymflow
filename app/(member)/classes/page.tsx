import Link from 'next/link';
import { Bell, CalendarX, Check } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { BookButton, CancelButton } from '@/components/member/class-actions';

export const metadata = { title: 'Schedule' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function splitTime(t: string): { hm: string; ap: string } {
  const [h, m = '00'] = (t ?? '00:00').split(':');
  const hh = parseInt(h, 10); const ap = hh < 12 ? 'AM' : 'PM'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ tab?: string; d?: string }> }) {
  const { user, gym } = await requireMember();
  const sp = await searchParams;
  const tab = sp.tab === 'book' ? 'book' : 'cal';
  const supabase = await createClient();

  const today = new Date();
  const todayDow = today.getDay();
  const todayStr = today.toISOString().slice(0, 10);
  const selDow = sp.d != null && !Number.isNaN(Number(sp.d)) ? (((Number(sp.d) % 7) + 7) % 7) : todayDow;
  const mondayOffset = (todayDow + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - mondayOffset);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return { dow: d.getDay(), dom: d.getDate(), label: SHORT[d.getDay()], isSel: d.getDay() === selDow };
  });

  const [{ data: classes }, { data: schedules }, { data: bookings }] = await Promise.all([
    supabase.from('classes').select('id, name, instructor, max_capacity').eq('gym_id', gym.id),
    supabase.from('class_schedules').select('id, day_of_week, start_time, room, class_id').eq('gym_id', gym.id).eq('is_active', true).order('start_time', { ascending: true }),
    supabase.from('class_bookings').select('id, booking_date, status, class_schedule_id, class_id').eq('member_id', user.id).neq('status', 'cancelled').order('booking_date', { ascending: true }),
  ]);

  const classMap = new Map((classes ?? []).map((c) => [c.id, c]));
  const schedMap = new Map((schedules ?? []).map((s) => [s.id, s]));
  const hasOnDow = new Set((schedules ?? []).map((s) => s.day_of_week));
  const bookedSet = new Set((bookings ?? []).filter((b) => (b.booking_date ?? '') >= todayStr).map((b) => b.class_schedule_id));
  const selSlots = (schedules ?? []).filter((s) => s.day_of_week === selDow);
  const myBookings = bookings ?? [];

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
              <Link key={i} href={`/classes?d=${d.dow}`} className={`cday${d.isSel ? ' on' : ''}`} style={{ textDecoration: 'none' }}>
                <span>{d.label}</span><b>{d.dom}</b><span className={`mk${hasOnDow.has(d.dow) ? '' : ' ghost'}`} />
              </Link>
            ))}
          </div>
          <div className="day-label">{DAYNAME[selDow]}{selDow === todayDow ? ' · Today' : ''}</div>
          {selSlots.length === 0 ? (
            <div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No classes</h3><p>Pick another day above.</p></div>
          ) : (
            <div className="cls-list">
              {selSlots.map((s) => {
                const c = s.class_id ? classMap.get(s.class_id) : null;
                const { hm, ap } = splitTime(s.start_time);
                const isBooked = bookedSet.has(s.id);
                return (
                  <div key={s.id} className="cls-card">
                    <div className="tm"><b>{hm}</b><span>{ap}</span></div>
                    <div className="info"><strong>{c?.name ?? 'Class'}</strong><small>{c?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small></div>
                    {isBooked ? <span className="bk-done"><Check size={13} strokeWidth={2.6} /> Booked</span> : <BookButton scheduleId={s.id} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        myBookings.length === 0 ? (
          <div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No bookings yet</h3><p>Book a class from the schedule tab.</p></div>
        ) : (
          <div className="cls-list">
            {myBookings.map((b) => {
              const sch = b.class_schedule_id ? schedMap.get(b.class_schedule_id) : null;
              const c = b.class_id ? classMap.get(b.class_id) : null;
              const d = b.booking_date ? new Date(b.booking_date) : null;
              const t = sch?.start_time ? splitTime(sch.start_time) : null;
              const upcoming = (b.booking_date ?? '') >= todayStr;
              return (
                <div key={b.id} className="bkg">
                  <div className="date"><b>{d ? d.getDate() : '—'}</b><span>{d ? SHORT[d.getDay()] : ''}</span></div>
                  <div className="m"><strong>{c?.name ?? 'Class'}</strong><small>{t ? `${t.hm} ${t.ap}` : ''}{sch?.room ? ` · ${sch.room}` : ''}</small></div>
                  {upcoming ? <CancelButton bookingId={b.id} /> : <span className={`gf-badge ${b.status === 'attended' ? 'gf-badge-success' : 'gf-badge'}`}>{b.status === 'attended' ? 'Attended' : 'Past'}</span>}
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
