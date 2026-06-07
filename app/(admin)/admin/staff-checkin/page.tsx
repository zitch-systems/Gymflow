import { ScanLine, Clock, TrendingUp, QrCode, Search, Check } from 'lucide-react';

export const metadata = { title: 'Check-In' };

const FEED = [
  { i: 'TA', name: 'Tunde Adeyemi', plan: 'Annual', t: '7:02' },
  { i: 'SB', name: 'Seyi Bello', plan: 'Monthly', t: '6:58' },
  { i: 'GU', name: 'Grace Udeh', plan: 'Annual', t: '6:51' },
  { i: 'HF', name: 'Halima F.', plan: 'Quarterly', t: '6:44' },
];

export default function AdminCheckin() {
  return (
    <>
      <div className="page-h"><div><h1>Check-In</h1><p>Friday, 30 May · 14 members in so far today</p></div></div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><ScanLine strokeWidth={1.9} /></div></div><div className="kpi-val">14</div><div className="kpi-lbl">Check-ins today</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">7:02</div><div className="kpi-lbl">Last check-in</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><TrendingUp strokeWidth={1.9} /></div></div><div className="kpi-val">68</div><div className="kpi-lbl">Peak hour (6–7am)</div></div>
      </section>

      <section className="ci-grid">
        <div className="scan">
          <div className="ring"><QrCode strokeWidth={1.75} /></div>
          <h2>Scan or search to check in</h2>
          <p>Members scan the door QR, or find them manually below.</p>
          <div className="find"><Search strokeWidth={1.75} /><input placeholder="Type a member name…" aria-label="Find member" /></div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Today&apos;s check-ins</h3><div className="sub"><span className="gf-status-dot active">Live</span></div></div></div>
          <div className="feed">
            {FEED.map((f) => (
              <div className="feed-row" key={f.name}>
                <span className="gf-avatar gf-avatar-sm">{f.i}</span>
                <span className="feed-meta"><strong>{f.name}</strong><small>{f.plan} · QR · Main entrance</small></span>
                <span className="feed-time">{f.t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
