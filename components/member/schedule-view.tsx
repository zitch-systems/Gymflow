'use client';

import { useSearchParams } from 'next/navigation';
import { CalendarX, Coffee } from 'lucide-react';
import { BookButton, CancelButton } from '@/components/member/class-actions';

export type ScheduleDay = { dow: number; dom: number; label: string; hasClasses: boolean; hasBooking: boolean };
export type ScheduleSlot = { id: string; dow: number; hm: string; ap: string; name: string; instructor: string; room: string | null; booked: boolean };
export type BookingRow = { id: string; dom: number | null; dow3: string; name: string; time: string; room: string | null; status: string; isUpcoming: boolean };

// Client-side schedule browser. The server page fetches the WHOLE week's slots
// and every booking in one pass, so switching day or tab costs zero round trips
// — the old <Link href="?d=…"> approach re-ran middleware auth + the member
// gate + four queries per tap just to re-filter data the client already had.
// The selection is DERIVED from the URL (useSearchParams reflects both real
// navigations and our history.replaceState taps), so tapping the tab-bar item
// while already here resets to today, deep links work, and URL and UI can
// never disagree.
export function ScheduleView({ days, slots, bookings, todayDow }: {
  days: ScheduleDay[];
  slots: ScheduleSlot[];
  bookings: BookingRow[];
  todayDow: number;
}) {
  const sp = useSearchParams();
  const dParam = sp.get('d');
  const selDow = dParam != null && dParam !== '' && !Number.isNaN(Number(dParam))
    ? (((Number(dParam) % 7) + 7) % 7)
    : todayDow;
  const tab: 'cal' | 'book' = sp.get('tab') === 'book' ? 'book' : 'cal';

  // replaceState keeps the URL shareable without a server navigation; Next
  // syncs it back into useSearchParams, which re-renders this component.
  const pickDay = (dow: number) =>
    window.history.replaceState(null, '', dow === todayDow ? '/classes' : `/classes?d=${dow}`);
  const pickTab = (t: 'cal' | 'book') =>
    window.history.replaceState(null, '', t === 'book' ? '/classes?tab=book' : selDow === todayDow ? '/classes' : `/classes?d=${selDow}`);

  const selSlots = slots.filter((s) => s.dow === selDow);
  const selDay = days.find((d) => d.dow === selDow);

  return (
    <>
      <div className="segtabs">
        <button type="button" className={tab === 'cal' ? 'on' : undefined} onClick={() => pickTab('cal')}>Schedule</button>
        <button type="button" className={tab === 'book' ? 'on' : undefined} onClick={() => pickTab('book')}>My bookings</button>
      </div>

      {tab === 'cal' ? (
        <div>
          <div className="calstrip">
            {days.map((d) => (
              <button type="button" key={d.dow} className={`cday${d.dow === selDow ? ' on' : ''}`} onClick={() => pickDay(d.dow)}>
                <span>{d.label}</span><b>{d.dom}</b>
                <span className={`mk${d.hasClasses ? '' : ' ghost'}`} style={d.hasBooking ? { background: 'var(--gf-accent)' } : undefined} />
              </button>
            ))}
          </div>
          <div className="day-label">
            {selDow === todayDow ? 'Today · ' : ''}{selDay?.label} {selDay?.dom}
          </div>
          {selSlots.length === 0 ? (
            <div className="empty"><div className="eic"><Coffee strokeWidth={1.6} /></div><h3>Rest day</h3><p>No classes scheduled. Recovery counts too.</p></div>
          ) : (
            <div className="cls-list">
              {selSlots.map((s) => (
                <div key={s.id} className="cls-card">
                  <div className="tm"><b>{s.hm}</b><span>{s.ap}</span></div>
                  <div className="info"><strong>{s.name}</strong><small>{s.instructor}{s.room ? ` · ${s.room}` : ''}</small></div>
                  {s.booked ? <span className="gf-badge gf-badge-success" style={{ padding: '5px 9px' }}>Booked</span> : <BookButton scheduleId={s.id} />}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        bookings.length === 0 ? (
          <div className="empty">
            <div className="eic"><CalendarX strokeWidth={1.6} /></div>
            <h3>No upcoming bookings</h3><p>Browse the schedule and reserve your spot.</p>
            <button type="button" className="gf-btn gf-btn-primary" onClick={() => pickTab('cal')}>Browse classes</button>
          </div>
        ) : (
          <div className="cls-list">
            {bookings.map((b) => (
              <div key={b.id} className="bkg">
                <div className="date"><b>{b.dom ?? '—'}</b><span>{b.dow3}</span></div>
                <div className="m"><strong>{b.name}</strong><small>{b.time}{b.room ? ` · ${b.room}` : ''}</small></div>
                {b.isUpcoming ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {b.status === 'waitlisted' && <span className="gf-badge gf-badge-warning">Waitlist</span>}
                    <CancelButton bookingId={b.id} />
                  </div>
                ) : <span className={`gf-badge ${b.status === 'attended' ? 'gf-badge-success' : 'gf-badge-neutral'}`}>{b.status === 'attended' ? 'Attended' : 'Past'}</span>}
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
