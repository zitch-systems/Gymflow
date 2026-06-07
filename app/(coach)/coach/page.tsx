import Link from 'next/link';
import { CalendarCheck, Users, Wallet, Calendar, TrendingUp, ArrowRight } from 'lucide-react';

export const metadata = { title: 'Today · Instructor' };

const TIMELINE = [
  { time: '06:30', tag: 'done', name: 'Sunrise HIIT', sub: 'Studio A · 20 booked', badge: ['gf-badge-neutral', 'Completed'] },
  { time: '09:00', tag: 'now', name: 'Power Lifting', sub: 'Weights floor · 12 booked', now: true, roster: ['A', 'B', 'C', '+9'] },
  { time: '13:00', tag: 'PT', name: 'PT — Chidi Okeke', sub: '1-on-1 · Pack 4 of 10', badge: ['gf-badge-brand', 'PT pack'] },
  { time: '17:30', tag: 'soon', name: 'Conditioning', sub: 'Studio B · 15 booked', btn: 'Roster' },
];
const EC = [50, 64, 58, 78, 70, 92];
const CLIENTS = [
  { i: 'CO', name: 'Chidi Okeke', sub: 'PT pack · 4 of 10 used' },
  { i: 'GU', name: 'Grace Udeh', sub: 'PT pack · 7 of 12 used' },
  { i: 'MA', name: 'Musa Abdul', sub: 'PT pack · 1 of 8 used' },
];

export default function CoachToday() {
  return (
    <>
      <div className="hdr"><h1>Today&apos;s lineup, <span>Femi</span></h1><p>Thursday, 30 May · 3 classes · 1 PT session · ₦42K earned this week</p></div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><CalendarCheck strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+2</span></div><div className="kpi-val">4</div><div className="kpi-lbl">Sessions today</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Users strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+18</span></div><div className="kpi-val">86</div><div className="kpi-lbl">Members coached / wk</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Wallet strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+9%</span></div><div className="kpi-val">₦168K</div><div className="kpi-lbl">Earnings this month</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Calendar strokeWidth={1.9} /></div></div><div className="kpi-val">3d</div><div className="kpi-lbl">Until next payout</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-h"><div><h3>My schedule</h3><div className="sub">Thursday, 30 May</div></div><Link className="link" href="/coach/classes">Full week <ArrowRight strokeWidth={2} /></Link></div>
          <div className="tl">
            {TIMELINE.map((t) => (
              <div className="tl-row" key={t.time}>
                <div className="tl-time"><b>{t.time}</b><span>{t.tag}</span></div>
                <div className={`tl-card${t.now ? ' now' : ''}`}>
                  <div className="info"><strong>{t.name}</strong><small>{t.sub}</small></div>
                  {t.badge && <span className={`gf-badge ${t.badge[0]}`}>{t.badge[1]}</span>}
                  {t.roster && <div className="roster">{t.roster.map((r, i) => <span key={i} className={`gf-avatar${r.startsWith('+') ? ' more' : ''}`}>{r}</span>)}</div>}
                  {t.btn && <button className="gf-btn gf-btn-sm gf-btn-secondary">{t.btn}</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="payout">
            <small>Next payout · 2 Jun</small>
            <div className="amt">₦42,000</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.92 }}>From 3 classes + 1 PT session this week</div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Earnings</h3><div className="sub">Last 6 weeks</div></div></div>
            <div className="ec">
              {EC.map((h, i) => <div className="col" key={i}><div className="bar" style={{ height: `${h}%` }} /><div className="lbl">W{i + 1}</div></div>)}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>PT clients</h3><div className="sub">5 active packs</div></div></div>
            {CLIENTS.map((c) => (
              <div className="cl-row" key={c.name}><span className="gf-avatar gf-avatar-sm">{c.i}</span><div className="m"><strong>{c.name}</strong><small>{c.sub}</small></div></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
