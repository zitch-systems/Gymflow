'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarX } from 'lucide-react';

export type AdminDay = { dow: number; name: string; dom: number | undefined; count: number };
export type AdminSlot = { id: string; dow: number; hm: string; ap: string; name: string; instructor: string; room: string | null; booked: number; cap: number };

// Client-side week browser for the admin timetable. All 7 days' slots arrive
// from the server in one pass; picking a day costs zero round trips. The
// selection is derived from the URL (useSearchParams reflects both real
// navigations and our history.replaceState taps), so the sidebar 'Classes'
// link resets to today and URL/UI always agree.
export function ClassesWeek({ days, slots, todayDow }: { days: AdminDay[]; slots: AdminSlot[]; todayDow: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const dParam = sp.get('d');
  const selDow = dParam != null && dParam !== '' && !Number.isNaN(Number(dParam))
    ? (((Number(dParam) % 7) + 7) % 7)
    : todayDow;
  const daySlots = slots.filter((s) => s.dow === selDow);

  const pick = (dow: number) => {
    window.history.replaceState(null, '', `/admin/classes?d=${dow}`);
    // Occupancy changes while the desk keeps this page open — refresh the RSC
    // props in the background so the booked/capacity bars stay live. The day
    // switch itself is instant; this never blocks it.
    router.refresh();
  };

  return (
    <>
      <div className="days">
        {days.map((d) => (
          <button type="button" key={d.dow} className={`day${selDow === d.dow ? ' on' : ''}`} onClick={() => pick(d.dow)}>
            <div className="dn">{d.name}</div><div className="dd">{d.dom}</div><div className="dc">{d.count} class{d.count === 1 ? '' : 'es'}</div>
          </button>
        ))}
      </div>

      {daySlots.length === 0 ? (
        <div className="panel"><div className="empty"><div className="eic"><CalendarX strokeWidth={1.6} /></div><h3>No classes that day</h3><p>Add a class to publish it on the timetable.</p></div></div>
      ) : (
        <div className="cls-list">
          {daySlots.map((s) => {
            const pct = s.cap > 0 ? Math.min(100, Math.round((s.booked / s.cap) * 100)) : 0;
            return (
              <Link className="clx" key={s.id} href={`/admin/classes/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="tm"><b>{s.hm}</b><span>{s.ap}</span></div>
                <div className="info"><strong>{s.name}</strong><small>{s.instructor}{s.room ? ` · ${s.room}` : ''}</small></div>
                <div className="cap">
                  <div className="lbl"><span>{s.booked}/{s.cap || '—'} booked</span><span>{s.cap > 0 ? `${pct}%` : ''}</span></div>
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
