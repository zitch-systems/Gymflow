'use client';

import { useState } from 'react';
import { CalendarDays, Ticket, Gauge, Hourglass, TrendingUp, Repeat } from 'lucide-react';

const DAYS = [
  { dn: 'MON', dd: 26, n: 4 }, { dn: 'TUE', dd: 27, n: 3 }, { dn: 'WED', dd: 28, n: 4 },
  { dn: 'THU', dd: 29, n: 4 }, { dn: 'FRI', dd: 30, n: 5 }, { dn: 'SAT', dd: 31, n: 4 }, { dn: 'SUN', dd: 1, n: 2 },
];

const SESSIONS = [
  { time: '06:30', name: 'Morning HIIT', coach: 'Coach Ada · Studio 1', booked: 18, cap: 20 },
  { time: '09:00', name: 'Power Yoga', coach: 'Coach Bisi · Studio B', booked: 12, cap: 16 },
  { time: '17:30', name: 'Spin Class', coach: 'Coach Tobi · Studio 2', booked: 20, cap: 20 },
  { time: '19:00', name: 'Strength 101', coach: 'Coach Seyi · Main floor', booked: 9, cap: 16 },
];

export default function AdminClasses() {
  const [day, setDay] = useState(3);
  return (
    <>
      <div className="page-h">
        <div><h1>Classes</h1><p>26 sessions this week · 412 bookings · 78% average fill</p></div>
        <button className="gf-btn gf-btn-secondary"><Repeat strokeWidth={1.9} size={16} /> Recurring</button>
      </div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><CalendarDays strokeWidth={1.9} /></div></div><div className="kpi-val">26</div><div className="kpi-lbl">Sessions / week</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Ticket strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+12%</span></div><div className="kpi-val">412</div><div className="kpi-lbl">Bookings</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Gauge strokeWidth={1.9} /></div></div><div className="kpi-val">78%</div><div className="kpi-lbl">Avg fill rate</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Hourglass strokeWidth={1.9} /></div></div><div className="kpi-val">34</div><div className="kpi-lbl">On waitlists</div></div>
      </section>

      <div className="days">
        {DAYS.map((d, i) => (
          <button key={d.dd} className={`day${day === i ? ' on' : ''}`} onClick={() => setDay(i)} style={{ border: 'none' }}>
            <div className="dn">{d.dn}</div><div className="dd">{d.dd}</div><div className="dc">{d.n} classes</div>
          </button>
        ))}
      </div>

      <div className="cls-list">
        {SESSIONS.map((s) => {
          const pct = Math.round((s.booked / s.cap) * 100);
          const full = s.booked >= s.cap;
          return (
            <div className="clx" key={s.name}>
              <div className="tm"><b>{s.time}</b><span>{full ? 'Full' : 'Open'}</span></div>
              <div className="info"><strong>{s.name}</strong><small>{s.coach}</small></div>
              <div className="cap">
                <div className="lbl"><span>{s.booked}/{s.cap} booked</span><span>{pct}%</span></div>
                <div className="track"><div className={`fill${pct >= 90 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
