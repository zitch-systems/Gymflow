import { Building2, Repeat, Hourglass, AlertTriangle, Search, UserPlus } from 'lucide-react';
import { GymTable } from '@/components/superadmin/gym-table';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Gyms' };

export default async function SuperGyms() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: gyms } = await supabase.from('gyms').select('status');
  const total = (gyms ?? []).length;
  const active = (gyms ?? []).filter((g) => (g.status ?? 'active') === 'active').length;
  const trial = (gyms ?? []).filter((g) => g.status === 'trial').length;
  const pastDue = (gyms ?? []).filter((g) => g.status === 'past_due').length;

  const KPIS = [
    { icon: Building2, fg: '#11d18b', bg: '#11d18b1f', val: String(total), lbl: 'Total gyms' },
    { icon: Repeat, fg: '#4080ff', bg: '#4080ff1f', val: String(active), lbl: 'Active' },
    { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: String(trial), lbl: 'On trial' },
    { icon: AlertTriangle, fg: '#ff4560', bg: '#ff45601f', val: String(pastDue), lbl: 'Past due' },
  ];

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Gyms</h1><p>{total} gym{total === 1 ? '' : 's'} · {trial} on trial · {pastDue} past due</p></div><button className="gf-btn gf-btn-primary"><UserPlus strokeWidth={1.9} size={16} /> Onboard a gym</button></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="toolbar"><div className="search"><Search strokeWidth={1.75} /><input placeholder="Search gyms…" aria-label="Search gyms" /></div><div style={{ flex: 1 }} /><span className="gf-chip active">All</span><span className="gf-chip">Active</span><span className="gf-chip">Trial</span><span className="gf-chip">Past due</span></div>
        <GymTable limit={100} />
      </div>
    </>
  );
}
