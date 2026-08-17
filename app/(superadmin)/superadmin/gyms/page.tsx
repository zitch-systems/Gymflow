import Link from 'next/link';
import { Building2, Repeat, Hourglass, AlertTriangle, Search, UserPlus } from 'lucide-react';
import { GymTable } from '@/components/superadmin/gym-table';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { sa } from '@/lib/superadmin-path';

export const metadata = { title: 'Gyms' };

const FILTERS = [['all', 'All'], ['active', 'Active'], ['trial', 'Trial'], ['past_due', 'Past due']] as const;
type FilterKey = (typeof FILTERS)[number][0];

export default async function SuperGyms({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all';
  const q = (sp.q ?? '').trim();
  const supabase = await createClient();
  const { data: gyms } = await supabase.from('gyms').select('subscription_status');
  const subStatus = (g: { subscription_status?: string | null }) => g.subscription_status ?? 'trial';
  const total = (gyms ?? []).length;
  const active = (gyms ?? []).filter((g) => subStatus(g) === 'active').length;
  const trial = (gyms ?? []).filter((g) => subStatus(g) === 'trial').length;
  const pastDue = (gyms ?? []).filter((g) => subStatus(g) === 'past_due').length;

  const KPIS = [
    { icon: Building2, fg: '#11d18b', bg: '#11d18b1f', val: String(total), lbl: 'Total gyms' },
    { icon: Repeat, fg: '#4080ff', bg: '#4080ff1f', val: String(active), lbl: 'Active' },
    { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: String(trial), lbl: 'On trial' },
    { icon: AlertTriangle, fg: '#ff4560', bg: '#ff45601f', val: String(pastDue), lbl: 'Past due' },
  ];

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Gyms</h1><p>{total} gym{total === 1 ? '' : 's'} · {trial} on trial · {pastDue} past due</p></div><Link href={sa('/onboard')} className="gf-btn gf-btn-primary" style={{ textDecoration: 'none' }}><UserPlus strokeWidth={1.9} size={16} /> Onboard a gym</Link></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="toolbar">
          <form className="search" action={sa('/gyms')} style={{ display: 'flex' }}>
            {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
            <Search strokeWidth={1.75} /><input name="q" defaultValue={q} placeholder="Search gyms…" aria-label="Search gyms" />
          </form>
          <div style={{ flex: 1 }} />
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={sa(`/gyms?${new URLSearchParams({ ...(k !== 'all' && { f: k }), ...(q && { q }) }).toString()}`)} className={filter === k ? 'gf-chip active' : 'gf-chip'} style={{ textDecoration: 'none' }}>{label}</Link>
          ))}
        </div>
        <GymTable limit={200} q={q} status={filter} />
      </div>
    </>
  );
}
