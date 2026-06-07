import { Users, Clock, GraduationCap, Banknote, Crown, Shield, ScanLine } from 'lucide-react';

export const metadata = { title: 'Staff' };

const TEAM = [
  { i: 'AO', name: 'Adunni O.', role: 'Owner', shift: 'All day', st: ['gf-badge-success', 'On shift'] },
  { i: 'KM', name: 'Kunle M.', role: 'Manager', shift: '09:00–17:00', st: ['gf-badge-success', 'On shift'] },
  { i: 'FE', name: 'Coach Femi', role: 'Instructor', shift: '10:00–18:00', st: ['gf-badge-success', 'On shift'] },
  { i: 'BI', name: 'Coach Bisi', role: 'Instructor', shift: '06:00–12:00', st: ['gf-badge-success', 'On shift'] },
  { i: 'TO', name: 'Coach Tobi', role: 'Instructor', shift: '16:00–20:00', st: ['gf-badge-neutral', 'Off'] },
  { i: 'DA', name: 'Deborah A.', role: 'Front desk', shift: '08:00–16:00', st: ['gf-badge-success', 'On shift'] },
];

const ROLES = [
  { icon: Crown, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', name: 'Owner', desc: 'Full access', ct: 1 },
  { icon: Shield, fg: '#4080ff', bg: '#4080ff1f', name: 'Manager', desc: 'All but billing', ct: 2 },
  { icon: GraduationCap, fg: '#a8d92e', bg: '#c6f24e1f', name: 'Instructor', desc: 'Classes & clients', ct: 5 },
  { icon: ScanLine, fg: '#ffb020', bg: '#ffb0201f', name: 'Front desk', desc: 'Check-in & members', ct: 1 },
];

const SHIFT = [
  { i: 'F', name: 'Coach Femi', sub: 'Instructor · until 18:00' },
  { i: 'B', name: 'Coach Bisi', sub: 'Instructor · until 12:00' },
  { i: 'D', name: 'Deborah A.', sub: 'Front desk · until 16:00' },
  { i: 'K', name: 'Kunle M.', sub: 'Manager · until 17:00' },
];

export default function AdminStaff() {
  return (
    <>
      <div className="page-h"><div><h1>Staff</h1><p>9 team members · 4 on shift now · payroll runs 30 May</p></div></div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><Users strokeWidth={1.9} /></div></div><div className="kpi-val">9</div><div className="kpi-lbl">Team members</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">4</div><div className="kpi-lbl">On shift now</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><GraduationCap strokeWidth={1.9} /></div></div><div className="kpi-val">5</div><div className="kpi-lbl">Instructors</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Banknote strokeWidth={1.9} /></div></div><div className="kpi-val">₦1.4M</div><div className="kpi-lbl">Monthly payroll</div></div>
      </section>

      <div className="grid2">
        <div className="panel">
          <div className="panel-h">
            <div><h3>Team</h3><div className="sub">Roles, status &amp; today&apos;s shift</div></div>
            <div style={{ display: 'flex', gap: 8 }}><span className="gf-chip active">All</span><span className="gf-chip">Instructors</span><span className="gf-chip">Front desk</span></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Member</th><th>Role</th><th>Shift today</th><th>Status</th></tr></thead>
            <tbody>
              {TEAM.map((m) => (
                <tr key={m.name}>
                  <td><div className="who"><span className="gf-avatar gf-avatar-sm">{m.i}</span><div><strong>{m.name}</strong></div></div></td>
                  <td><span className="role-chip" style={{ background: 'var(--gf-elevated)' }}>{m.role}</span></td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{m.shift}</td>
                  <td><span className={`gf-badge ${m.st[0]}`}>{m.st[1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Roles</h3><div className="sub">Access levels</div></div></div>
            <div className="role-grid">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <div className="role-row" key={r.name}>
                    <div className="ic" style={{ background: r.bg, color: r.fg }}><Icon strokeWidth={1.9} /></div>
                    <div className="m"><strong>{r.name}</strong><small>{r.desc}</small></div>
                    <span className="ct">{r.ct}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>On shift now</h3><div className="sub">Live</div></div></div>
            {SHIFT.map((s) => (
              <div className="scard" key={s.name}>
                <span className="gf-avatar gf-avatar-sm">{s.i}</span>
                <div className="m"><strong>{s.name}</strong><small>{s.sub}</small></div>
                <span className="on-shift" style={{ color: 'var(--gf-success)' }}>In</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
