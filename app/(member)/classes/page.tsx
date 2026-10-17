import Link from 'next/link';
import { Bell, CalendarX, Coffee } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watNow } from '@/lib/format';
import { nextOccurrenceDate } from '@/lib/class-dates';
import { isUpcomingMemberBooking, memberScheduleDays, memberSessionKey } from '@/lib/member-schedule';
import { BookButton, CancelButton } from '@/components/member/class-actions';
import { AddToCalendar } from '@/components/member/add-to-calendar';

export const metadata = { title: 'Schedule' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Three-letter day names, as in revamp/member.html's calstrip ("MON 9" …).
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  // WAT wall-clock via getUTC*; the server clock is UTC.
  const today = watNow();
  const todayDow = today.getUTCDay();
  const todayStr = today.toISOString().slice(0, 10);
  const week = memberScheduleDays(today, sp.d);
  const selectedDay = week.find((day) => day.selected)!;
  const selDow = selectedDay.dow;

  const [{ data: classes, error: classError }, { data: schedules, error: scheduleError }, { data: bookings, error: bookingError }, { count: unread }] = await Promise.all([
    supabase.from('classes').select('id, name, instructor, max_capacity, duration_minutes').eq('gym_id', gym.id),
    supabase.from('class_schedules').select('id, day_of_week, start_time, room, class_id').eq('gym_id', gym.id).eq('is_active', true).order('start_time', { ascending: true }),
    // gym_id as well as member_id — see the same fix in app/api/app/classes:
    // a member of two gyms otherwise sees the other gym's bookings against
    // this gym's schedule map.
    supabase.from('class_bookings').select('id, booking_date, status, class_schedule_id, class_id').eq('gym_id', gym.id).eq('member_id', user.id).neq('status', 'cancelled').order('booking_date', { ascending: true }),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
  ]);
  if (classError || scheduleError || bookingError) throw new Error('Your class schedule could not be loaded. Please try again.');

  const classMap = new Map((classes ?? []).map((c) => [c.id, c]));
  const schedMap = new Map((schedules ?? []).map((s) => [s.id, s]));
  const hasOnDow = new Set((schedules ?? []).map((s) => s.day_of_week));
  const upcoming = (bookings ?? []).filter((b) => (b.booking_date ?? '') >= todayStr && (b.status === 'booked' || b.status === 'waitlisted'));
  const bookedSessions = new Map(upcoming.filter((b) => b.class_schedule_id && b.booking_date)
    .map((b) => [memberSessionKey(b.class_schedule_id!, b.booking_date!), b]));
  const bookedDates = new Set(upcoming.map((b) => b.booking_date));
  const selSlots = (schedules ?? []).filter((s) => s.day_of_week === selDow
    && nextOccurrenceDate(s.day_of_week, s.start_time, today) === selectedDay.date);
  const myBookings = bookings ?? [];
  const unreadCount = unread ?? 0;

  return (
    <section className="view on" data-v="schedule">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <strong className="htitle">Schedule</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} />{unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
      </div>

      <div className="segtabs">
        <Link href="/classes" className={tab === 'cal' ? 'on' : undefined} aria-current={tab === 'cal' ? 'page' : undefined}>Schedule</Link>
        <Link href="/classes?tab=book" className={tab === 'book' ? 'on' : undefined} aria-current={tab === 'book' ? 'page' : undefined}>My bookings</Link>
      </div>

      {tab === 'cal' ? (
        <div>
          <div className="calstrip">
            {week.map((d) => (
              <Link key={d.date} href={`/classes?d=${d.dow}`} className={`cday${d.selected ? ' on' : ''}`} aria-current={d.selected ? 'date' : undefined} aria-label={`${SHORT[d.dow]} ${d.date}`}>
                <span>{SHORT[d.dow]}</span><b>{d.dom}</b>
                <span className={`mk${hasOnDow.has(d.dow) ? '' : ' ghost'}`} style={bookedDates.has(d.date) ? { background: 'var(--gf-accent)' } : undefined} />
              </Link>
            ))}
          </div>
          <div className="day-label">
            {selDow === todayDow ? 'Today · ' : ''}{SHORT[selDow]} {selectedDay.dom}
          </div>
          {selSlots.length === 0 ? (
            <div className="empty"><div className="eic"><Coffee strokeWidth={1.6} /></div><h3>{selDow === todayDow ? 'No more classes today' : 'Rest day'}</h3><p>Choose another day to find your next class.</p></div>
          ) : (
            <div className="cls-list">
              {selSlots.map((s) => {
                const c = s.class_id ? classMap.get(s.class_id) : null;
                const { hm, ap } = splitTime(s.start_time);
                const booking = bookedSessions.get(memberSessionKey(s.id, selectedDay.date));
                return (
                  <div key={s.id} className="cls-card">
                    <div className="tm"><b>{hm}</b><span>{ap}</span></div>
                    <Link href={`/classes/${s.id}`} className="info" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <strong>{c?.name ?? 'Class'}</strong><small>{c?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small>
                    </Link>
                    {booking ? <span className={`gf-badge ${booking.status === 'waitlisted' ? 'gf-badge-warning' : 'gf-badge-success'}`} style={{ padding: '5px 9px' }}>{booking.status === 'waitlisted' ? 'Waitlisted' : 'Booked'}</span> : <BookButton key={memberSessionKey(s.id, selectedDay.date)} scheduleId={s.id} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        myBookings.length === 0 ? (
          <div className="empty">
            <div className="eic"><CalendarX strokeWidth={1.6} /></div>
            <h3>No upcoming bookings</h3><p>Browse the schedule and reserve your spot.</p>
            <Link href="/classes" className="gf-btn gf-btn-primary">Browse classes</Link>
          </div>
        ) : (
          <div className="cls-list">
            {myBookings.map((b) => {
              const sch = b.class_schedule_id ? schedMap.get(b.class_schedule_id) : null;
              const c = b.class_id ? classMap.get(b.class_id) : null;
              // Parse as local midnight — bare YYYY-MM-DD parses as UTC and can shift a day.
              const d = b.booking_date ? new Date(`${b.booking_date}T00:00:00`) : null;
              const t = sch?.start_time ? splitTime(sch.start_time) : null;
              const isUpcoming = (b.status === 'booked' || b.status === 'waitlisted') && isUpcomingMemberBooking(b.booking_date, sch?.start_time, today);
              return (
                <div key={b.id} className="bkg">
                  <div className="date"><b>{d ? d.getDate() : '—'}</b><span>{d ? SHORT[d.getDay()] : ''}</span></div>
                  <div className="m"><strong>{c?.name ?? 'Class'}</strong><small>{t ? `${t.hm} ${t.ap}` : ''}{sch?.room ? ` · ${sch.room}` : ''}</small></div>
                  {isUpcoming ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {b.status === 'waitlisted' && <span className="gf-badge gf-badge-warning">Waitlist</span>}
                      {b.status !== 'waitlisted' && b.booking_date && sch?.start_time && (
                        <AddToCalendar event={{
                          title: `${c?.name ?? 'Class'} · ${gym.name}`,
                          dateStr: b.booking_date,
                          startTime: sch.start_time,
                          durationMin: Number((c as { duration_minutes?: number | null })?.duration_minutes ?? 60) || 60,
                          location: gym.name,
                          details: [c?.instructor ? `Instructor: ${c.instructor}` : '', sch.room ? `Room: ${sch.room}` : ''].filter(Boolean).join('\n'),
                          uid: b.id,
                        }} />
                      )}
                      <CancelButton bookingId={b.id} />
                    </div>
                  ) : <span className={`gf-badge ${b.status === 'attended' ? 'gf-badge-success' : 'gf-badge-neutral'}`}>{b.status === 'attended' ? 'Attended' : 'Past'}</span>}
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
