'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

const WEEK = [
  { dow: 'Mon', dom: 9, has: true }, { dow: 'Tue', dom: 10, has: true },
  { dow: 'Wed', dom: 11, has: true, on: true }, { dow: 'Thu', dom: 12, has: true },
  { dow: 'Fri', dom: 13, has: true }, { dow: 'Sat', dom: 14, has: false }, { dow: 'Sun', dom: 15, has: false },
];

const CLASSES = [
  { time: '06:30', ap: 'AM', name: 'Morning HIIT', sub: 'Coach Ada · Studio 1 · 18/20', badge: '2 left', tone: 'gf-badge-warning' },
  { time: '17:30', ap: 'PM', name: 'Spin Class', sub: 'Coach Tobi · Studio 2', badge: 'Booked', tone: 'gf-badge-success' },
  { time: '19:00', ap: 'PM', name: 'Strength 101', sub: 'Coach Seyi · Main floor · 9/16', badge: '7 left', tone: 'gf-badge-neutral' },
];

const BOOKINGS = [
  { dom: 11, dow: 'Wed', name: 'Spin Class', sub: '17:30 · Coach Tobi · Studio 2' },
  { dom: 13, dow: 'Fri', name: 'Yoga Flow', sub: '19:00 · Coach Ada · Studio 1' },
];

// Schedule — recreates revamp/member.html "schedule": Schedule / My bookings
// tabs, week calendar strip, day class list, booking rows. Static data.
export default function SchedulePage() {
  const [tab, setTab] = useState<'cal' | 'book'>('cal');

  return (
    <section className="view on" data-v="schedule">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <strong className="htitle">Schedule</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} /><span className="nub">3</span>
        </Link>
      </div>

      <div className="segtabs">
        <button className={tab === 'cal' ? 'on' : undefined} onClick={() => setTab('cal')}>Schedule</button>
        <button className={tab === 'book' ? 'on' : undefined} onClick={() => setTab('book')}>My bookings</button>
      </div>

      {tab === 'cal' ? (
        <div>
          <div className="calstrip">
            {WEEK.map((d) => (
              <div key={d.dom} className={`cday${d.on ? ' on' : ''}`}>
                <span>{d.dow}</span>
                <b>{d.dom}</b>
                <span className={`mk${d.has ? '' : ' ghost'}`} />
              </div>
            ))}
          </div>
          <div className="day-label">Today · Wed 11</div>
          <div className="cls-list">
            {CLASSES.map((c) => (
              <Link key={c.name} href="/classes" className="cls-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="tm"><b>{c.time}</b><span>{c.ap}</span></div>
                <div className="info"><strong>{c.name}</strong><small>{c.sub}</small></div>
                <span className={`gf-badge ${c.tone}`}>{c.badge}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="cls-list">
          {BOOKINGS.map((b) => (
            <div key={b.dom} className="bkg">
              <div className="date"><b>{b.dom}</b><span>{b.dow}</span></div>
              <div className="m"><strong>{b.name}</strong><small>{b.sub}</small></div>
              <button className="cancel">Cancel</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
