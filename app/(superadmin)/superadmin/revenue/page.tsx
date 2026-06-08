import { Repeat, Banknote, CreditCard, Wallet } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';

export const metadata = { title: 'Revenue' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLORS = ['#11d18b', '#4080ff', '#c6f24e', '#ffb020', '#ff4560'];

export default async function SuperRevenue() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: monthPay }, { data: allPay }, { count: activeSubs }] = await Promise.all([
    supabase.from('payments').select('amount').eq('payment_status', 'successful').gte('payment_date', monthStart.toISOString()),
    supabase.from('payments').select('amount, payment_date, created_at, plan_id').eq('payment_status', 'successful'),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);
  const all = allPay ?? [];
  const monthProcessed = (monthPay ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const allProcessed = all.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const platformFees = Math.round(allProcessed * 0.03);

  // Real trailing-12-month revenue bars.
  const months: { label: string; total: number }[] = [];
  const idx = new Map<string, number>();
  const base = new Date(); base.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base); d.setMonth(d.getMonth() - i);
    idx.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
    months.push({ label: d.toLocaleString('en-NG', { month: 'short' }), total: 0 });
  }
  for (const p of all) {
    const d = new Date(p.payment_date ?? p.created_at ?? '');
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i != null) months[i].total += Number(p.amount ?? 0);
  }
  const maxT = Math.max(1, ...months.map((m) => m.total));

  // Real revenue-by-plan mix (top 5 plans by all-time revenue).
  const byPlan = new Map<string, number>();
  for (const p of all) { const k = p.plan_id ?? 'other'; byPlan.set(k, (byPlan.get(k) ?? 0) + Number(p.amount ?? 0)); }
  const planIds = [...byPlan.keys()].filter((k) => k !== 'other');
  const { data: planRows } = planIds.length
    ? await supabase.from('membership_plans').select('id, name').in('id', planIds)
    : { data: [] as { id: string; name: string | null }[] };
  const planName = new Map((planRows ?? []).map((p) => [p.id, p.name]));
  const ranked = [...byPlan.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mixTotal = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  const mix = ranked.map(([id, v], i) => ({
    label: id === 'other' ? 'Other' : (planName.get(id) ?? 'Plan'),
    pct: Math.round((v / mixTotal) * 100),
    color: COLORS[i % COLORS.length],
  }));
  let acc = 0;
  const stops = mix.map((m) => { const start = acc; acc += m.pct; return `${m.color} ${start}% ${acc}%`; }).join(', ');
  const donut = mix.length ? `conic-gradient(${stops})` : 'conic-gradient(var(--gf-border) 0 100%)';

  const KPIS = [
    { icon: Wallet, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(monthProcessed), lbl: 'Processed this month' },
    { icon: Banknote, fg: '#11d18b', bg: '#11d18b1f', val: fmtNaira(allProcessed), lbl: 'Processed all-time' },
    { icon: CreditCard, fg: '#4080ff', bg: '#4080ff1f', val: fmtNaira(platformFees), lbl: 'Platform fees (≈3%)' },
    { icon: Repeat, fg: '#ff4560', bg: '#ff45601f', val: String(activeSubs ?? 0), lbl: 'Active subscriptions' },
  ];

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
          <div className="panel-h"><div><h3>Revenue growth</h3><div className="sub">Trailing 12 months</div></div></div>
          <div className="bars" style={{ height: 200 }}>{months.map((m, i) => <div className="bcol" key={i}><div className="bar" style={{ height: `${Math.max(2, Math.round((m.total / maxT) * 100))}%` }} data-v={fmtNaira(m.total)} /><div className="blbl">{m.label}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Revenue by plan</h3><div className="sub">Share of payments</div></div></div>
          {mix.length ? (
            <>
              <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}><div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} /></div>
              <div className="legend">{mix.map((m) => <div className="lg-row" key={m.label}><span className="lg-dot" style={{ background: m.color }} /><span className="nm">{m.label}</span><span className="vl">{m.pct}%</span></div>)}</div>
            </>
          ) : (
            <div className="empty sm"><h3>No revenue yet</h3><p>Plan breakdown appears once payments are recorded.</p></div>
          )}
        </div>
      </section>
    </>
  );
}
