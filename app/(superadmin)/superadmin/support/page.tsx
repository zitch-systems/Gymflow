import { LifeBuoy, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
export const metadata = { title: 'Support' };
const KPIS = [
  { icon: LifeBuoy, fg: '#11d18b', bg: '#11d18b1f', val: '14', lbl: 'Open tickets' },
  { icon: AlertTriangle, fg: '#ff4560', bg: '#ff45601f', val: '2', lbl: 'Urgent' },
  { icon: Clock, fg: '#4080ff', bg: '#4080ff1f', val: '3.2h', lbl: 'Median first response' },
  { icon: CheckCircle2, fg: '#a8d92e', bg: '#c6f24e1f', val: '92%', lbl: 'CSAT this month' },
];
const TICKETS = [
  { i: 'F', name: 'FitHub Enugu', sub: 'Payout not received · ₦37,999', st: ['gf-badge-danger', 'Urgent'], t: '12m' },
  { i: 'P', name: 'Peak Fitness', sub: 'How do I add an instructor?', st: ['gf-badge-warning', 'Open'], t: '1h' },
  { i: 'S', name: 'Summit Fitness', sub: 'Subdomain SSL question', st: ['gf-badge-neutral', 'Waiting'], t: '3h' },
  { i: 'I', name: 'IronWorks Gym', sub: 'Bulk member import', st: ['gf-badge-success', 'Resolved'], t: '1d' },
];
export default function SuperSupport() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Support</h1><p>14 open tickets · 2 urgent · 3.2h median first response</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="panel-h"><div><h3>Open tickets</h3><div className="sub">Across all gyms</div></div></div>
        {TICKETS.map((t) => (
          <div className="act-row" key={t.name}><span className="gf-avatar gf-avatar-sm">{t.i}</span><div className="m"><strong>{t.name}</strong><small>{t.sub}</small></div><span className={`gf-badge ${t.st[0]}`}>{t.st[1]}</span><span className="t" style={{ marginLeft: 10 }}>{t.t}</span></div>
        ))}
      </div>
    </>
  );
}
