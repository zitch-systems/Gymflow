'use client';

import { useState } from 'react';
import { Wallet, ScanLine, Repeat, TrendingDown, TrendingUp, Download } from 'lucide-react';

const CHECKINS = [
  { d: 'Mon', h: 70 }, { d: 'Tue', h: 54 }, { d: 'Wed', h: 62 }, { d: 'Thu', h: 88 },
  { d: 'Fri', h: 60 }, { d: 'Sat', h: 38 }, { d: 'Sun', h: 24 },
];
const GROWTH = [
  { d: 'Jan', h: 40 }, { d: 'Feb', h: 52 }, { d: 'Mar', h: 58 }, { d: 'Apr', h: 70 },
  { d: 'May', h: 82 }, { d: 'Jun', h: 96 },
];
const MIX = [
  { label: 'Monthly', pct: 52, color: '#11d18b' },
  { label: 'Quarterly', pct: 30, color: '#4080ff' },
  { label: 'Annual', pct: 18, color: '#c6f24e' },
];

export default function AdminAnalytics() {
  const [range, setRange] = useState('30');
  // Donut via conic-gradient from the plan-mix percentages.
  const donut = `conic-gradient(#11d18b 0 52%, #4080ff 52% 82%, #c6f24e 82% 100%)`;

  return (
    <>
      <div className="page-h">
        <div><h1>Analytics</h1><p>Powerhouse Fitness · trends across revenue, attendance and growth</p></div>
        <div className="seg">
          {['7', '30', '90'].map((r) => (
            <button key={r} className={range === r ? 'on' : undefined} onClick={() => setRange(r)}>{r} days</button>
          ))}
        </div>
      </div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Wallet strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+16%</span></div><div className="kpi-val">₦5.8M</div><div className="kpi-lbl">Revenue (30d)</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><ScanLine strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+19%</span></div><div className="kpi-val">412</div><div className="kpi-lbl">Check-ins (30d)</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><Repeat strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+3%</span></div><div className="kpi-val">96%</div><div className="kpi-lbl">Retention</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ff45601f', color: '#ff4560' }}><TrendingDown strokeWidth={1.9} /></div><span className="delta down"><TrendingDown strokeWidth={2} />0.6%</span></div><div className="kpi-val">2.1%</div><div className="kpi-lbl">Churn</div></div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Revenue trend</h3><div className="sub">Last 30 days · ₦5.8M collected</div></div><span className="link"><Download strokeWidth={2} size={14} /> Export</span></div>
          <div className="bars">
            {GROWTH.map((b) => (
              <div className="bcol" key={b.d}><div className="bar" style={{ height: `${b.h}%` }} data-v={`${b.h}`} /><div className="blbl">{b.d}</div></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Plan mix</h3><div className="sub">By active members</div></div></div>
          <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} />
          </div>
          <div className="legend">
            {MIX.map((m) => (
              <div className="lg-row" key={m.label}><span className="lg-dot" style={{ background: m.color }} /><span className="nm">{m.label}</span><span className="vl">{m.pct}%</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel">
          <div className="panel-h"><div><h3>Check-ins by day</h3><div className="sub">This week · peak Mon &amp; Thu</div></div></div>
          <div className="bars">
            {CHECKINS.map((b) => (
              <div className="bcol" key={b.d}><div className="bar" style={{ height: `${b.h}%` }} data-v={`${b.h}`} /><div className="blbl">{b.d}</div></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Member growth</h3><div className="sub">Net new members / month</div></div></div>
          <div className="bars">
            {GROWTH.map((b) => (
              <div className="bcol" key={b.d}><div className="bar" style={{ height: `${b.h}%` }} data-v={`${b.h}`} /><div className="blbl">{b.d}</div></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
