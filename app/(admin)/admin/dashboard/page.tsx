import Link from 'next/link';
import {
  Users, ScanLine, Clock, Wallet, ArrowRight, Zap, TrendingUp,
} from 'lucide-react';

export const metadata = { title: 'Overview' };

const KPIS = [
  { icon: Users, fg: '#11d18b', bg: 'rgba(17,209,139,0.12)', val: '482', lbl: 'Active members', delta: '+12', up: true },
  { icon: ScanLine, fg: '#4080ff', bg: 'rgba(64,128,255,0.12)', val: '14', lbl: 'Check-ins today', delta: '+3', up: true },
  { icon: Clock, fg: '#ffb020', bg: 'rgba(255,176,32,0.12)', val: '18', lbl: 'Expiring this week', delta: '−2', up: false },
  { icon: Wallet, fg: '#a8d92e', bg: 'rgba(198,242,78,0.12)', val: '₦1.24M', lbl: 'Revenue · 7 days', delta: '+8%', up: true },
];

const REV = [40, 62, 48, 80, 55, 92, 70];
const REV_MAX = Math.max(...REV);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MEMBERS = [
  { i: 'TA', name: 'Tunde Adeyemi', email: 'tunde@…', plan: 'Annual', status: ['gf-badge-success', 'Active'], renews: '12 Mar', value: '₦119,999' },
  { i: 'NE', name: 'Ngozi Eze', email: 'ngozi@…', plan: 'Quarterly', status: ['gf-badge-warning', 'Expiring'], renews: '3 days', value: '₦37,999' },
  { i: 'KO', name: 'Kelechi Obi', email: 'kelechi@…', plan: 'Monthly', status: ['gf-badge-success', 'Active'], renews: '21 Mar', value: '₦13,999' },
  { i: 'AY', name: 'Amara Yusuf', email: 'amara@…', plan: 'Monthly', status: ['gf-badge-danger', 'Expired'], renews: '—', value: '₦13,999' },
];

const FEED = [
  { i: 'TA', name: 'Tunde Adeyemi', method: 'QR · Main entrance', t: '7:02' },
  { i: 'SB', name: 'Seyi Bello', method: 'QR · Main entrance', t: '6:58' },
  { i: 'HF', name: 'Halima F.', method: 'Front desk', t: '6:44' },
];

const ATTENTION = [
  { i: 'NE', name: 'Ngozi Eze', note: 'Quarterly expires in 3 days' },
  { i: 'CO', name: 'Chidi Okafor', note: 'Monthly expires tomorrow' },
  { i: 'BA', name: 'Bola A.', note: 'Payment failed · retry due' },
];

const CLASSES = [
  { time: '06:30', name: 'Morning HIIT', sub: 'Coach Ada · Studio 1', cap: '18/20' },
  { time: '12:30', name: 'Lunch Express', sub: 'Coach Seyi · Main floor', cap: '11/16' },
  { time: '17:30', name: 'Spin Class', sub: 'Coach Tobi · Studio 2', cap: '20/20' },
];

export default function AdminDashboard() {
  return (
    <>
      <div className="hdr">
        <div>
          <h1>Good morning, <span>Adunni</span></h1>
          <p>Friday, 30 May · 14 check-ins so far today · 3 memberships need attention</p>
        </div>
        <div className="seg">
          <button className="on">Today</button>
          <button>Week</button>
          <button>Month</button>
        </div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top">
                <div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div>
                <span className={`kpi-delta ${k.up ? 'up' : 'down'}`}><TrendingUp strokeWidth={2} /> {k.delta}</span>
              </div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </section>

      <section className="grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h">
              <div><h3>Revenue</h3><div className="sub">Last 7 days · ₦1.24M collected</div></div>
              <Link className="link" href="/admin/analytics">View report <ArrowRight strokeWidth={2} /></Link>
            </div>
            <div className="chart">
              {REV.map((v, i) => (
                <div className="bar-col" key={i}>
                  <div className="bar" style={{ height: `${Math.round((v / REV_MAX) * 100)}%` }} data-v={`₦${v}k`} />
                  <span className="bar-lbl">{DOW[i]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Members</h3><div className="sub">482 active · 18 expiring this week</div></div>
              <Link className="link" href="/admin/members">All members <ArrowRight strokeWidth={2} /></Link>
            </div>
            <div className="tbl-tabs">
              <span className="gf-chip active">All</span>
              <span className="gf-chip">Active</span>
              <span className="gf-chip">Expiring</span>
              <span className="gf-chip">Expired</span>
            </div>
            <table className="mtbl">
              <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Renews</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>
                {MEMBERS.map((m) => (
                  <tr key={m.name}>
                    <td><div className="who"><span className="gf-avatar gf-avatar-sm">{m.i}</span><div><strong>{m.name}</strong><small>{m.email}</small></div></div></td>
                    <td>{m.plan}</td>
                    <td><span className={`gf-badge ${m.status[0]}`}>{m.status[1]}</span></td>
                    <td>{m.renews}</td>
                    <td className="naira" style={{ textAlign: 'right' }}>{m.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h">
              <div><h3>Live check-ins</h3><div className="sub"><span className="gf-status-dot active">Live</span></div></div>
              <span className="link"><Zap strokeWidth={2} /> Simulate</span>
            </div>
            <div className="feed">
              {FEED.map((f) => (
                <div className="feed-row" key={f.name}>
                  <span className="gf-avatar gf-avatar-sm">{f.i}</span>
                  <span className="feed-meta"><strong>{f.name}</strong><small>{f.method}</small></span>
                  <span className="feed-time">{f.t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h"><div><h3>Needs attention</h3><div className="sub">Memberships expiring soon</div></div></div>
            <div className="att">
              {ATTENTION.map((a) => (
                <div className="att-row" key={a.name}>
                  <span className="gf-avatar gf-avatar-sm">{a.i}</span>
                  <span className="att-meta"><strong>{a.name}</strong><small>{a.note}</small></span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h"><div><h3>Today&apos;s classes</h3><div className="sub">4 sessions scheduled</div></div></div>
            <div className="cls">
              {CLASSES.map((c) => (
                <div className="cls-row" key={c.name}>
                  <span className="cls-time">{c.time}</span>
                  <span className="cls-meta"><strong>{c.name}</strong><small>{c.sub}</small></span>
                  <span className="cap">{c.cap}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
