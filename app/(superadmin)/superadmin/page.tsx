import Link from 'next/link';
import { Building2, Repeat, Users, UserPlus, ArrowRight, Banknote } from 'lucide-react';
import { GymTable } from '@/components/superadmin/gym-table';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

export const metadata = { title: 'Platform overview' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID = ['success', 'successful', 'completed', 'paid'];

export default async function SuperOverview() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const since12 = new Date(); since12.setDate(1); since12.setMonth(since12.getMonth() - 11);

  const [{ count: members }, { count: activeSubs }, { data: gymRows }, { data: pays }, { data: recent }] = await Promise.all([
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('gyms').select('id, name, status'),
    supabase.from('payments').select('amount, payment_date, created_at, status').gte('payment_date', since12.toISOString()).in('status', PAID),
    supabase.from('payments').select('amount, payment_date, gym_id, status').in('status', PAID).order('payment_date', { ascending: false }).limit(5),
  ]);

  const gymList = gymRows ?? [];
  const gymName = new Map(gymList.map((g) => [g.id, g.name]));
  const gyms = gymList.length;
  const trial = gymList.filter((g) => g.status === 'trial').length;
  const pastDue = gymList.filter((g) => g.status === 'past_due' || g.status === 'past due').length;

  // Trailing-12-month revenue series from real payments.
  const months: { label: string; total: number }[] = [];
  const idx = new Map<string, number>();
  const base = new Date(); base.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base); d.setMonth(d.getMonth() - i);
    idx.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
    months.push({ label: d.toLocaleString('en-NG', { month: 'short' }), total: 0 });
  }
  for (const p of pays ?? []) {
    const d = new Date(p.payment_date ?? p.created_at ?? '');
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i != null) months[i].total += Number(p.amount ?? 0);
  }
  const trailingTotal = months.reduce((s, m) => s + m.total, 0);
  const maxT = Math.max(1, ...months.map((m) => m.total));
  const pts = months.map((m, i) => `${(i / (months.length - 1)) * 600},${150 - (m.total / maxT) * 138}`).join(' ');

  const KPIS = [
    { icon: Building2, fg: '#11d18b', bg: '#11d18b1f', val: String(gyms), lbl: 'Active gyms' },
    { icon: Users, fg: '#4080ff', bg: '#4080ff1f', val: String(members ?? 0), lbl: 'Members platform-wide' },
    { icon: Repeat, fg: '#a8d92e', bg: '#c6f24e1f', val: String(activeSubs ?? 0), lbl: 'Active subscriptions' },
    { icon: Banknote, fg: '#ffb020', bg: '#ffb0201f', val: fmtNaira(trailingTotal), lbl: 'Revenue (12 mo)' },
  ];

  return (
    <>
      <div className="hdr">
        <div><span className="pill-plat">Platform overview</span><h1>{gyms} gym{gyms === 1 ? '' : 's'} running on GymFlow</h1><p>{members ?? 0} members · {activeSubs ?? 0} active subscriptions platform-wide</p></div>
        <Link className="gf-btn gf-btn-primary" href="/superadmin/onboard"><UserPlus strokeWidth={1.9} size={16} /> Onboard a gym</Link>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}>
            <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div>
            <div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div>
          </div>
        ); })}
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-h"><div><h3>Platform MRR</h3><div className="sub">Trailing 12 months · {fmtNaira(trailingTotal)}</div></div><Link className="link" href="/superadmin/revenue">Revenue report <ArrowRight strokeWidth={2} /></Link></div>
          <svg viewBox="0 0 600 170" className="area" preserveAspectRatio="none" aria-hidden>
            <polyline points={pts} fill="none" stroke="#11d18b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--gf-text-muted)', fontSize: '0.68rem', fontWeight: 600, marginTop: 8 }}>
            {months.filter((_, i) => i % 2 === 0).map((m, i) => <span key={i}>{m.label}</span>)}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Recent activity</h3><div className="sub">Latest payments</div></div><Link className="link" href="/superadmin/audit">Audit log <ArrowRight strokeWidth={2} /></Link></div>
          {(recent ?? []).length === 0 ? (
            <div className="empty sm"><h3>No activity yet</h3><p>Payments across gyms will appear here.</p></div>
          ) : (recent ?? []).map((a, i) => (
            <div className="act-row" key={i}><div className="ic" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><Banknote strokeWidth={1.9} /></div><div className="m"><strong>{fmtNaira(Number(a.amount ?? 0))} received</strong><small>{gymName.get(a.gym_id ?? '') ?? 'Gym'}</small></div><span className="t">{fmtDate(a.payment_date)}</span></div>
          ))}
        </div>
      </section>

      <div className="panel">
        <div className="panel-h">
          <div><h3>Gyms</h3><div className="sub">{gyms} total · {trial} on trial · {pastDue} past due</div></div>
          <div style={{ display: 'flex', gap: 8 }}><span className="gf-chip active">All</span><span className="gf-chip">Active</span><span className="gf-chip">Trial</span><span className="gf-chip">Past due</span></div>
        </div>
        <GymTable />
      </div>
    </>
  );
}
