import { Repeat, Banknote, CreditCard, Building2 } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { PLATFORM_PLANS, isPlanTier, PLAN_TIERS } from '@/lib/platform-plans';

export const metadata = { title: 'Revenue' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLORS = ['#11d18b', '#4080ff', '#c6f24e', '#ffb020', '#ff4560'];

// Platform revenue = what GYMS pay GymFlow (the SaaS subscription), NOT what
// members pay their gyms. The latter (member GMV) flows through gyms and is shown
// separately as context — it is not the platform's revenue.
export default async function SuperRevenue() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: gyms }, { data: platPay }, { data: memberPay }] = await Promise.all([
    supabase.from('gyms').select('subscription_plan, subscription_status'),
    supabase.from('platform_payments').select('amount, plan, created_at, billing_period_start').eq('payment_status', 'successful'),
    supabase.from('payments').select('amount').eq('payment_status', 'successful'),
  ]);

  const allGyms = gyms ?? [];
  const activeGyms = allGyms.filter((g) => g.subscription_status === 'active');
  const trialing = allGyms.filter((g) => (g.subscription_status ?? 'trial') === 'trial').length;
  const pastDue = allGyms.filter((g) => g.subscription_status === 'past_due').length;

  // MRR = sum of active gyms' plan prices.
  const mrr = activeGyms.reduce((s, g) => {
    const tier = isPlanTier(g.subscription_plan ?? '') ? (g.subscription_plan as 'starter' | 'growth' | 'scale') : null;
    return s + (tier ? PLATFORM_PLANS[tier].amountKobo / 100 : 0);
  }, 0);

  const plat = platPay ?? [];
  // Bucket on the billing period, not row-insert time: the self-heal billing
  // callback can insert a row days after the charge, which would otherwise put
  // revenue in the wrong month.
  const periodOf = (p: { billing_period_start?: string | null; created_at?: string | null }) => p.billing_period_start ?? p.created_at ?? '';
  const platMonth = plat.filter((p) => new Date(periodOf(p)) >= monthStart).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const platAllTime = plat.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const memberGmv = (memberPay ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Trailing-12-month platform revenue bars.
  const months: { label: string; total: number }[] = [];
  const idx = new Map<string, number>();
  const base = new Date(); base.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base); d.setMonth(d.getMonth() - i);
    idx.set(`${d.getFullYear()}-${d.getMonth()}`, months.length);
    months.push({ label: d.toLocaleString('en-NG', { month: 'short' }), total: 0 });
  }
  for (const p of plat) {
    const d = new Date(periodOf(p));
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i != null) months[i].total += Number(p.amount ?? 0);
  }
  const maxT = Math.max(1, ...months.map((m) => m.total));

  // Active subscriptions by plan tier (the MRR mix).
  const byTier = new Map<string, number>();
  for (const g of activeGyms) {
    const tier = isPlanTier(g.subscription_plan ?? '') ? g.subscription_plan! : 'other';
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
  }
  const ranked = PLAN_TIERS.map((t) => [t, byTier.get(t) ?? 0] as const).filter(([, n]) => n > 0);
  const mixTotal = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  const mix = ranked.map(([tier, v], i) => ({
    label: PLATFORM_PLANS[tier].name, count: v,
    pct: Math.round((v / mixTotal) * 100), color: COLORS[i % COLORS.length],
  }));
  let acc = 0;
  const stops = mix.map((m) => { const start = acc; acc += m.pct; return `${m.color} ${start}% ${acc}%`; }).join(', ');
  const donut = mix.length ? `conic-gradient(${stops})` : 'conic-gradient(var(--gf-border) 0 100%)';

  const KPIS = [
    { icon: Repeat, fg: '#11d18b', bg: '#11d18b1f', val: fmtNaira(mrr), lbl: 'Platform MRR (active gyms)' },
    { icon: Banknote, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(platMonth), lbl: 'Collected this month' },
    { icon: CreditCard, fg: '#4080ff', bg: '#4080ff1f', val: fmtNaira(platAllTime), lbl: 'Collected all-time' },
    { icon: Building2, fg: '#ff4560', bg: '#ff45601f', val: `${activeGyms.length}`, lbl: `Paying gyms · ${trialing} trial · ${pastDue} past due` },
  ];

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Revenue</h1><p>{fmtNaira(mrr)} MRR · {fmtNaira(platMonth)} collected this month · {activeGyms.length} paying gyms</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Platform revenue</h3><div className="sub">Subscription income · trailing 12 months</div></div></div>
          {/* bars--dense: 12 month columns can't shrink below their label's
              min-content width, so on phones the tail of the chart rendered
              OUTSIDE the panel. The modifier lets columns compress and shows
              alternate labels at phone widths. */}
          <div className="bars bars--dense" style={{ height: 200 }}>{months.map((m, i) => <div className="bcol" key={i}><div className="bar" style={{ height: `${Math.max(2, Math.round((m.total / maxT) * 100))}%` }} data-v={fmtNaira(m.total)} /><div className="blbl">{m.label}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Subscriptions by plan</h3><div className="sub">Active gyms per tier</div></div></div>
          {mix.length ? (
            <>
              <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}><div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} /></div>
              <div className="legend">{mix.map((m) => <div className="lg-row" key={m.label}><span className="lg-dot" style={{ background: m.color }} /><span className="nm">{m.label}</span><span className="vl">{m.count} · {m.pct}%</span></div>)}</div>
            </>
          ) : (
            <div className="empty sm"><h3>No paying gyms yet</h3><p>The plan mix appears once gyms subscribe.</p></div>
          )}
        </div>
      </section>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h"><div><h3>Member payment volume (GMV)</h3><div className="sub">Money members pay their gyms — flows to gyms, not platform revenue</div></div></div>
        <div style={{ padding: '6px 2px', fontSize: '1.5rem', fontWeight: 700 }}>{fmtNaira(memberGmv)}<span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--gf-text-muted)', marginLeft: 10 }}>processed across all gyms, all-time</span></div>
      </section>
    </>
  );
}
