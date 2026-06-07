import { Users, UserPlus, TrendingDown, Activity, TrendingUp, Search } from 'lucide-react';
export const metadata = { title: 'All members' };
const KPIS = [
  { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: '486,204', lbl: 'Total members', delta: '+3.4K' },
  { icon: Activity, fg: '#4080ff', bg: '#4080ff1f', val: '71%', lbl: 'Active monthly' },
  { icon: UserPlus, fg: '#a8d92e', bg: '#c6f24e1f', val: '3,420', lbl: 'New this month' },
  { icon: TrendingDown, fg: '#ff4560', bg: '#ff45601f', val: '2.1%', lbl: 'Churn' },
];
const ROWS = [
  { i: 'TA', name: 'Tunde Adeyemi', email: 'tunde@email.ng', gym: 'Powerhouse', plan: 'Annual', st: ['gf-badge-success', 'Active'] },
  { i: 'GU', name: 'Grace Udeh', email: 'grace@email.ng', gym: 'IronWorks', plan: 'Scale', st: ['gf-badge-success', 'Active'] },
  { i: 'MA', name: 'Musa Abdul', email: 'musa@email.ng', gym: 'FlexZone', plan: 'Monthly', st: ['gf-badge-warning', 'Expiring'] },
  { i: 'BA', name: 'Bola Ade', email: 'bola@email.ng', gym: 'FitHub', plan: 'Quarterly', st: ['gf-badge-danger', 'Lapsed'] },
];
export default function SuperMembers() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>All members</h1><p>486,204 members across 1,204 gyms · +3,420 this month · 2.1% churn</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div>{k.delta && <span className="delta up"><TrendingUp strokeWidth={2} />{k.delta}</span>}</div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="toolbar"><div className="search"><Search strokeWidth={1.75} /><input placeholder="Search across every gym…" aria-label="Search members" /></div></div>
        <table className="gt">
          <thead><tr><th>Member</th><th>Gym</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>{ROWS.map((r) => (
            <tr key={r.name}><td><div className="gname"><span className="sq" style={{ background: 'linear-gradient(135deg,#11d18b,#07a86c)' }}>{r.i}</span><div><strong>{r.name}</strong><small>{r.email}</small></div></div></td><td style={{ color: 'var(--gf-text-secondary)' }}>{r.gym}</td><td>{r.plan}</td><td><span className={`gf-badge ${r.st[0]}`}>{r.st[1]}</span></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
