import Link from 'next/link';
import { Repeat, Banknote, CreditCard, Building2, Coins } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { PLATFORM_PLANS, isPlanTier, PLAN_TIERS, normalizeCycle, monthlyEquivalentKobo, type PlanTier } from '@/lib/platform-plans';
import {
  COMMISSION_PERIODS, commissionPeriod, summarizeCommission, type GymCommissionRow,
} from '@/lib/commission-breakdown';
import { sa } from '@/lib/superadmin-path';
import { monthLabel, parseRevenueSummary } from '@/lib/platform-revenue';

export const metadata = { title: 'Revenue' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLORS = ['#11d18b', '#4080ff', '#c6f24e', '#ffb020', '#ff4560'];

// How many gyms the commission table renders. Every total on the page is summed
// over ALL gyms in the database (see summarizeCommission) — this caps the list
// only, and what it leaves out is stated under the table rather than quietly
// dropped, so a short table is never mistaken for the whole book.
const GYM_ROWS = 50;

/** `as never` on an rpc NAME collapses the whole builder to `never`; the
 *  aggregate postdates the generated types, so it goes through this wrapper. */
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

// Platform revenue has two halves and they are not the same money:
//
//   · the SaaS subscription GYMS pay GymFlow (platform_payments) — the MRR and
//     the collected figures below;
//   · the COMMISSION GymFlow keeps out of what members pay their gyms, taken at
//     settlement by Paystack's split.
//
// Member GMV is neither: it is the gyms' own revenue, shown only as the context
// the commission is a slice of.
export default async function SuperRevenue({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const period = commissionPeriod(sp.p);
  const supabase = await createClient();

  const [{ data: gyms }, revenueRes, commissionRes] = await Promise.all([
    supabase.from('gyms').select('subscription_plan, subscription_status, subscription_billing_cycle'),
    // Summed in Postgres: a fetched row list is capped at PostgREST's max-rows,
    // which froze these totals once there were more than 1000 payments.
    (supabase as unknown as RpcClient).rpc('platform_revenue_summary', { p_months: 12 }),
    // Aggregated in Postgres, one row per gym, over every qualifying payment —
    // not a page of rows summed here. See the migration's header for what
    // qualifies (splits only, successful, non-refunded).
    (supabase as unknown as RpcClient).rpc('platform_commission_by_gym', {
      p_from: period.from ? period.from.toISOString() : null,
      p_to: null,
    }),
  ]);

  const commission = summarizeCommission((commissionRes.data as GymCommissionRow[] | null) ?? [], GYM_ROWS);

  const allGyms = gyms ?? [];
  const activeGyms = allGyms.filter((g) => g.subscription_status === 'active');
  const trialing = allGyms.filter((g) => (g.subscription_status ?? 'trial') === 'trial').length;
  const pastDue = allGyms.filter((g) => g.subscription_status === 'past_due').length;

  // MRR = sum of active gyms' plan prices, normalised to a month. Nobody is
  // billed monthly any more — a quarterly plan contributes a third of its charge
  // and an annual one a twelfth, so the figure stays comparable month to month
  // instead of spiking whenever a gym renews.
  const mrr = activeGyms.reduce((s, g) => {
    const tier = isPlanTier(g.subscription_plan ?? '') ? (g.subscription_plan as PlanTier) : null;
    return s + (tier ? monthlyEquivalentKobo(tier, normalizeCycle(g.subscription_billing_cycle)) / 100 : 0);
  }, 0);

  // Platform collections are bucketed on billing_period_start (the self-heal
  // billing callback can insert a row days after the charge).
  if (revenueRes.error) throw new Error(`platform_revenue_summary failed: ${revenueRes.error.message}`);
  const revenue = parseRevenueSummary(revenueRes.data);
  const platMonth = revenue.platformThisMonth;
  const platAllTime = revenue.platformAllTime;
  const memberGmv = revenue.memberGmv;

  // Trailing-12-month platform revenue bars.
  const months = revenue.platformMonthly.map((m) => ({ label: monthLabel(m.month), total: m.total }));
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

      {/* GymFlow's slice of the GMV above. Every figure here is what Paystack
          actually split at settlement, recorded per payment — never today's rate
          applied to historical volume. */}
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h">
          <div><h3>Commission from member payments</h3><div className="sub">GymFlow’s cut of member subscription payments · {period.label.toLowerCase()}</div></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {COMMISSION_PERIODS.map(([k, label]) => (
              <Link key={k} href={sa(k === COMMISSION_PERIODS[0][0] ? '/revenue' : `/revenue?p=${k}`)} className={period.key === k ? 'gf-chip active' : 'gf-chip'} style={{ textDecoration: 'none' }}>{label}</Link>
            ))}
          </div>
        </div>

        <div style={{ padding: '6px 2px 14px', fontSize: '1.5rem', fontWeight: 700 }}>
          {fmtNaira(commission.total)}
          <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--gf-text-muted)', marginLeft: 10 }}>
            kept across {commission.payments.toLocaleString('en-NG')} payment{commission.payments === 1 ? '' : 's'} from {commission.earningGyms} gym{commission.earningGyms === 1 ? '' : 's'}
            {' · '}{fmtNaira(commission.fromPercentage)} from percentage rates · {fmtNaira(commission.fromFlat)} from flat fees
            {commission.unclassified > 0 ? ` · ${fmtNaira(commission.unclassified)} recorded without a basis` : ''}
          </span>
        </div>

        {commission.rows.length === 0 ? (
          <div className="empty"><div className="eic"><Coins strokeWidth={1.6} /></div><h3>No commission in this period</h3><p>Commission is recorded when a member pays a gym that has connected its Paystack payouts.</p></div>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="gt">
                <thead><tr><th>Gym</th><th>Rate today</th><th style={{ textAlign: 'right' }}>Payments</th><th style={{ textAlign: 'right' }}>From rate</th><th style={{ textAlign: 'right' }}>From flat fee</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
                <tbody>{commission.rows.map((g) => (
                  <tr key={g.gymId}>
                    <td><Link className="link" href={sa(`/gyms/${g.gymId}`)} style={{ textDecoration: 'none' }}><strong>{g.name}</strong></Link></td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{g.rateLabel}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gf-text-secondary)' }}>{g.payments.toLocaleString('en-NG')}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gf-text-secondary)' }} className="naira">{g.fromPercentage ? fmtNaira(g.fromPercentage) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gf-text-secondary)' }} className="naira">{g.fromFlat ? fmtNaira(g.fromFlat) : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="naira"><strong>{fmtNaira(g.commission)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {commission.hiddenGyms > 0 && (
              <div className="sub" style={{ padding: '10px 2px 0' }}>
                Showing the top {commission.rows.length} gyms by commission. {commission.hiddenGyms} more gym{commission.hiddenGyms === 1 ? '' : 's'} account for a further {fmtNaira(commission.hiddenCommission)}, already included in the {fmtNaira(commission.total)} total above.
              </div>
            )}
          </>
        )}

        {/* Money that is NOT commission, kept out of every figure above and
            stated rather than hidden: a gym with no Paystack subaccount has its
            members' payments land whole in GymFlow's account, so the platform is
            holding the gym's share, not earning it. */}
        {commission.held > 0 && (
          <div className="sub" style={{ padding: '10px 2px 0' }}>
            Separately, {fmtNaira(commission.held)} across {commission.heldPayments.toLocaleString('en-NG')} payment{commission.heldPayments === 1 ? '' : 's'} settled wholly into GymFlow’s account because those gyms have no Paystack split — that is money <strong>held and owed to gyms</strong>, not commission earned, and none of it is counted above.
          </div>
        )}
        {commission.unrecordedPayments > 0 && (
          <div className="sub" style={{ padding: '6px 2px 0' }}>
            {commission.unrecordedPayments.toLocaleString('en-NG')} payment{commission.unrecordedPayments === 1 ? '' : 's'} in this period predate per-payment commission records, so what was taken on them is not known and is not estimated here.
          </div>
        )}
      </section>
    </>
  );
}
