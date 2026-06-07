import Link from 'next/link';
import { Building2, Repeat, Users, TrendingDown, TrendingUp, UserPlus, ArrowRight, Banknote, AlertTriangle, ArrowUpCircle } from 'lucide-react';
import { GymTable } from '@/components/superadmin/gym-table';

export const metadata = { title: 'Platform overview' };

const KPIS = [
  { icon: Building2, fg: '#11d18b', bg: '#11d18b1f', val: '1,204', lbl: 'Active gyms', delta: '+41', up: true },
  { icon: Repeat, fg: '#a8d92e', bg: '#c6f24e1f', val: '₦18.7M', lbl: 'Platform MRR', delta: '+12%', up: true },
  { icon: Users, fg: '#4080ff', bg: '#4080ff1f', val: '486K', lbl: 'Members platform-wide', delta: '+3.4K', up: true },
  { icon: TrendingDown, fg: '#ff4560', bg: '#ff45601f', val: '2.1%', lbl: 'Monthly churn', delta: '1.8%', up: false },
];
const ACT = [
  { icon: Building2, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', title: 'New gym onboarded', sub: 'FlexZone Yaba · Growth plan', t: '8m ago' },
  { icon: Banknote, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: '₦119,999 subscription paid', sub: 'IronWorks Gym · Scale', t: '22m ago' },
  { icon: AlertTriangle, fg: 'var(--gf-warning)', bg: 'var(--gf-warning-soft)', title: 'Payment past due', sub: 'FitHub Enugu · retry in 24h', t: '1h ago' },
  { icon: ArrowUpCircle, fg: 'var(--gf-info)', bg: 'var(--gf-info-soft)', title: 'Plan upgraded', sub: 'Powerhouse · Growth → Scale', t: '3h ago' },
];
const MRR = [160, 150, 155, 138, 128, 132, 112, 104, 92, 82, 66, 52, 40];

export default function SuperOverview() {
  const max = Math.max(...MRR);
  const pts = MRR.map((v, i) => `${(i / (MRR.length - 1)) * 600},${v}`).join(' ');
  return (
    <>
      <div className="hdr">
        <div><span className="pill-plat">Platform overview</span><h1>1,204 gyms running on GymFlow</h1><p>May · ₦96.4M processed · 99.96% uptime · 41 new gyms this month</p></div>
        <Link className="gf-btn gf-btn-primary" href="/superadmin/onboard"><UserPlus strokeWidth={1.9} size={16} /> Onboard a gym</Link>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}>
            <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div><span className={`delta ${k.up ? 'up' : 'down'}`}>{k.up ? <TrendingUp strokeWidth={2} /> : <TrendingDown strokeWidth={2} />}{k.delta}</span></div>
            <div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div>
          </div>
        ); })}
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-h"><div><h3>Platform MRR</h3><div className="sub">Trailing 12 months · ₦18.7M</div></div><Link className="link" href="/superadmin/revenue">Revenue report <ArrowRight strokeWidth={2} /></Link></div>
          <svg viewBox="0 0 600 170" className="area" preserveAspectRatio="none" aria-hidden>
            <polyline points={pts} fill="none" stroke="#11d18b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--gf-text-muted)', fontSize: '0.68rem', fontWeight: 600, marginTop: 8 }}>
            <span>Jun</span><span>Aug</span><span>Oct</span><span>Dec</span><span>Feb</span><span>Apr</span><span>May</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Recent activity</h3><div className="sub">Platform-wide</div></div><Link className="link" href="/superadmin/audit">Audit log <ArrowRight strokeWidth={2} /></Link></div>
          {ACT.map((a, i) => { const Icon = a.icon; return (
            <div className="act-row" key={i}><div className="ic" style={{ background: a.bg, color: a.fg }}><Icon strokeWidth={1.9} /></div><div className="m"><strong>{a.title}</strong><small>{a.sub}</small></div><span className="t">{a.t}</span></div>
          ); })}
        </div>
      </section>

      <div className="panel">
        <div className="panel-h">
          <div><h3>Gyms</h3><div className="sub">1,204 total · 38 on trial · 6 past due</div></div>
          <div style={{ display: 'flex', gap: 8 }}><span className="gf-chip active">All</span><span className="gf-chip">Active</span><span className="gf-chip">Trial</span><span className="gf-chip">Past due</span></div>
        </div>
        <GymTable />
      </div>
    </>
  );
}
