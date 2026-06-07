import { Repeat, Banknote, CreditCard, Wallet } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';

export const metadata = { title: 'Revenue' };

const BARS = [52, 58, 61, 66, 70, 74, 79, 83, 88, 91, 96, 100];
const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
const MIX = [['Scale', 44, '#11d18b'], ['Growth', 38, '#4080ff'], ['Starter', 18, '#c6f24e']] as const;

export default async function SuperRevenue() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: monthPay }, { data: allPay }, { count: activeSubs }] = await Promise.all([
    supabase.from('payments').select('amount, payment_status').eq('payment_status', 'successful').gte('payment_date', monthStart.toISOString()),
    supabase.from('payments').select('amount, payment_status').eq('payment_status', 'successful'),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);
  const monthProcessed = (monthPay ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const allProcessed = (allPay ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const platformFees = Math.round(allProcessed * 0.03); // ~3% platform commission

  const KPIS = [
    { icon: Wallet, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(monthProcessed), lbl: 'Processed this month' },
    { icon: Banknote, fg: '#11d18b', bg: '#11d18b1f', val: fmtNaira(allProcessed), lbl: 'Processed all-time' },
    { icon: CreditCard, fg: '#4080ff', bg: '#4080ff1f', val: fmtNaira(platformFees), lbl: 'Platform fees (≈3%)' },
    { icon: Repeat, fg: '#ff4560', bg: '#ff45601f', val: String(activeSubs ?? 0), lbl: 'Active subscriptions' },
  ];

  const donut = `conic-gradient(#11d18b 0 44%, #4080ff 44% 82%, #c6f24e 82% 100%)`;
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Revenue</h1><p>{fmtNaira(monthProcessed)} processed this month · {fmtNaira(allProcessed)} all-time · {activeSubs ?? 0} active subscriptions</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>MRR growth</h3><div className="sub">Trailing 12 months</div></div></div>
          <div className="bars" style={{ height: 200 }}>{BARS.map((h, i) => <div className="bcol" key={i}><div className="bar" style={{ height: `${h}%` }} data-v={`${h}`} /><div className="blbl">{MONTHS[i]}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Revenue by plan</h3><div className="sub">Share of MRR</div></div></div>
          <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}><div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} /></div>
          <div className="legend">{MIX.map(([l, p, c]) => <div className="lg-row" key={l}><span className="lg-dot" style={{ background: c }} /><span className="nm">{l}</span><span className="vl">{p}%</span></div>)}</div>
        </div>
      </section>
    </>
  );
}
