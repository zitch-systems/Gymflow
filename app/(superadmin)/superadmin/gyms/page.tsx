import { Building2, Repeat, Hourglass, AlertTriangle, Search, UserPlus } from 'lucide-react';
import { GymTable } from '@/components/superadmin/gym-table';
export const metadata = { title: 'Gyms' };
const KPIS = [
  { icon: Building2, fg: '#11d18b', bg: '#11d18b1f', val: '1,204', lbl: 'Total gyms' },
  { icon: Repeat, fg: '#4080ff', bg: '#4080ff1f', val: '1,160', lbl: 'Active' },
  { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: '38', lbl: 'On trial' },
  { icon: AlertTriangle, fg: '#ff4560', bg: '#ff45601f', val: '6', lbl: 'Past due' },
];
export default function SuperGyms() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Gyms</h1><p>1,204 gyms · 38 on trial · 6 past due</p></div><button className="gf-btn gf-btn-primary"><UserPlus strokeWidth={1.9} size={16} /> Onboard a gym</button></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="toolbar"><div className="search"><Search strokeWidth={1.75} /><input placeholder="Search gyms…" aria-label="Search gyms" /></div><div style={{ flex: 1 }} /><span className="gf-chip active">All</span><span className="gf-chip">Active</span><span className="gf-chip">Trial</span><span className="gf-chip">Past due</span></div>
        <GymTable />
      </div>
    </>
  );
}
