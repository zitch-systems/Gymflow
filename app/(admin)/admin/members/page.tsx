import { Users, Clock, UserX, UserPlus, TrendingUp, Search, Filter, Download } from 'lucide-react';

export const metadata = { title: 'Members' };

const KPIS = [
  { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: '482', lbl: 'Active members', delta: '+12' },
  { icon: Clock, fg: '#ffb020', bg: '#ffb0201f', val: '18', lbl: 'Expiring this week' },
  { icon: UserX, fg: '#ff4560', bg: '#ff45601f', val: '26', lbl: 'Lapsed' },
  { icon: UserPlus, fg: '#4080ff', bg: '#4080ff1f', val: '31', lbl: 'New this month', delta: '+8' },
];

const ROWS = [
  { i: 'TA', name: 'Tunde Adeyemi', email: 'tunde@email.ng', plan: 'Annual', st: ['gf-badge-success', 'Active'], joined: 'Jan 2024', renews: '12 Mar 2027', value: '₦119,999' },
  { i: 'NE', name: 'Ngozi Eze', email: 'ngozi@email.ng', plan: 'Quarterly', st: ['gf-badge-warning', 'Expiring'], joined: 'Mar 2024', renews: 'in 3 days', value: '₦37,999' },
  { i: 'KO', name: 'Kelechi Obi', email: 'kelechi@email.ng', plan: 'Monthly', st: ['gf-badge-success', 'Active'], joined: 'Nov 2024', renews: '21 Mar', value: '₦13,999' },
  { i: 'GU', name: 'Grace Udeh', email: 'grace@email.ng', plan: 'Annual', st: ['gf-badge-success', 'Active'], joined: 'Feb 2025', renews: '28 May 2027', value: '₦119,999' },
  { i: 'AY', name: 'Amara Yusuf', email: 'amara@email.ng', plan: 'Monthly', st: ['gf-badge-danger', 'Expired'], joined: 'Aug 2024', renews: '—', value: '₦13,999' },
  { i: 'CO', name: 'Chidi Okafor', email: 'chidi@email.ng', plan: 'Monthly', st: ['gf-badge-warning', 'Expiring'], joined: 'Dec 2024', renews: 'tomorrow', value: '₦13,999' },
];

export default function AdminMembers() {
  return (
    <>
      <div className="page-h">
        <div><h1>Members</h1><p>482 active · 18 expiring this week · 26 lapsed</p></div>
        <div className="seg"><button className="on">All</button><button>Active</button><button>Expiring</button><button>Expired</button></div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top">
                <div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div>
                {k.delta && <span className="delta up"><TrendingUp strokeWidth={2} />{k.delta}</span>}
              </div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </section>

      <div className="panel">
        <div className="toolbar">
          <div className="search"><Search strokeWidth={1.75} /><input placeholder="Search by name or email…" aria-label="Search members" /></div>
          <div style={{ flex: 1 }} />
          <button className="gf-btn gf-btn-secondary gf-btn-sm"><Filter strokeWidth={1.9} size={15} /> Filters</button>
          <button className="gf-btn gf-btn-secondary gf-btn-sm"><Download strokeWidth={1.9} size={15} /> Export</button>
        </div>
        <table className="tbl">
          <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Joined</th><th>Renews</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name}>
                <td><div className="who"><span className="gf-avatar gf-avatar-sm">{r.i}</span><div><strong>{r.name}</strong><small>{r.email}</small></div></div></td>
                <td>{r.plan}</td>
                <td><span className={`gf-badge ${r.st[0]}`}>{r.st[1]}</span></td>
                <td style={{ color: 'var(--gf-text-secondary)' }}>{r.joined}</td>
                <td style={{ color: 'var(--gf-text-secondary)' }}>{r.renews}</td>
                <td className="naira" style={{ textAlign: 'right' }}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
