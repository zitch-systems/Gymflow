import { Wallet, ScanLine, Users, CreditCard } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { parseGymReportingSummary, type ReportingRpcClient } from '@/lib/reporting';

export const metadata = { title: 'Analytics' };

const PLAN_COLORS = ['#11d18b', '#4080ff', '#c6f24e', '#ffb020', '#b67bf3'];

// Revenue analytics are finance-only — the nav hides this item from front desk
// (admin-shell FINANCE), so gate the page the same way instead of a bare
// requireStaff() that would let front desk open it by direct URL. Mirrors the
// billing page's gate.
const FINANCE_ROLES = ['gym_owner', 'owner', 'manager', 'accountant'] as const;

export default async function AdminAnalytics() {
  const { gym } = await requireStaff(FINANCE_ROLES);
  const supabase = await createClient();

  const result = await (supabase as unknown as ReportingRpcClient)
    .rpc('gym_reporting_summary', { p_gym_id: gym.id });
  if (result.error) throw new Error(`gym_reporting_summary failed: ${result.error.message}`);
  const summary = parseGymReportingSummary(result.data);

  // The SQL summary selects one deterministic current row per active roster
  // link, then applies the WAT access window. Past-due paid members remain in
  // the active base; future starts and paused memberships do not.
  const members = summary.activeAccess;
  const churned = summary.churned30d;
  const churnBase = members + churned;
  const churnPct = churnBase ? Math.round((churned / churnBase) * 100) : 0;

  const revenue30 = summary.revenue30d;

  // The RPC returns every WAT day, including zeroes, so six seven-day slices
  // cannot be shortened by PostgREST's response cap.
  const weeks = Array.from({ length: 6 }, (_, i) => ({
    label: `W${i + 1}`,
    amount: summary.revenueDaily.slice(i * 7, i * 7 + 7).reduce((sum, day) => sum + day.total, 0),
  }));
  const wkMax = Math.max(1, ...weeks.map((w) => w.amount));
  // Total across the 6 weekly bars — the panel label reflects the chart's own
  // window (was mislabeled "in 30 days" over this 6-week / 42-day chart, while the
  // 30-day figure lives on the "Revenue (30d)" KPI above).
  const revenue6w = weeks.reduce((s, w) => s + w.amount, 0);

  // Check-ins by WAT day (last 7).
  const byDay = summary.checkinDaily.map((day) => ({
    label: new Date(`${day.day}T12:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short' }),
    n: day.total,
  }));
  const dayMax = Math.max(1, ...byDay.map((d) => d.n));

  // Plan mix from the same current, entitled population as the KPI.
  const totalSubs = summary.planMix.reduce((sum, plan) => sum + plan.total, 0);
  const mix = summary.planMix.map((plan, i) => ({
    label: plan.name,
    pct: totalSubs ? Math.round((plan.total / totalSubs) * 100) : 0,
    color: PLAN_COLORS[i % PLAN_COLORS.length],
  }));
  let acc = 0;
  const donutStops = mix.map((m) => { const from = acc; acc += m.pct; return `${m.color} ${from}% ${acc}%`; }).join(', ');
  const donut = mix.length ? `conic-gradient(${donutStops})` : 'var(--gf-elevated)';

  const KPIS = [
    { icon: Wallet, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(revenue30), lbl: 'Revenue (30d)' },
    { icon: ScanLine, fg: '#4080ff', bg: '#4080ff1f', val: String(summary.checkins7d), lbl: 'Check-ins (7d)' },
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(members), lbl: 'Active members' },
    // Churn replaces the old "Active subs" tile — that figure is already the
    // plan-mix donut's total, while churn had no home despite being a headline
    // marketing claim ("track revenue, churn & attendance").
    { icon: CreditCard, fg: '#ffb020', bg: '#ffb0201f', val: `${churnPct}%`, lbl: `Churn (30d) · ${churned} lapsed` },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Analytics</h1><p>{gym.name} · trends across revenue, attendance and growth</p></div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Revenue trend</h3><div className="sub">Last 6 weeks · {fmtNaira(revenue6w)} collected</div></div></div>
          <div className="bars">
            {weeks.map((w) => (
              <div className="bcol" key={w.label}><div className="bar" style={{ height: `${Math.round((w.amount / wkMax) * 100)}%` }} data-v={fmtNaira(w.amount)} /><div className="blbl">{w.label}</div></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Plan mix</h3><div className="sub">By active members</div></div></div>
          {mix.length === 0 ? (
            <div className="sub" style={{ padding: '20px 0' }}>No active subscriptions yet.</div>
          ) : (
            <>
              <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} />
              </div>
              <div className="legend">
                {mix.map((m) => (
                  <div className="lg-row" key={m.label}><span className="lg-dot" style={{ background: m.color }} /><span className="nm">{m.label}</span><span className="vl">{m.pct}%</span></div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* g-even, not an inline gridTemplateColumns — the inline style beat the
          mobile collapse and the two charts overlapped at phone widths. */}
      <section className="grid2 g-even">
        <div className="panel">
          <div className="panel-h"><div><h3>Check-ins by day</h3><div className="sub">Last 7 days</div></div></div>
          <div className="bars">
            {byDay.map((b, i) => (
              <div className="bcol" key={i}><div className="bar" style={{ height: `${Math.round((b.n / dayMax) * 100)}%` }} data-v={`${b.n}`} /><div className="blbl">{b.label}</div></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Members</h3><div className="sub">Active membership base</div></div></div>
          <div style={{ display: 'grid', placeItems: 'center', padding: '28px 0' }}>
            <div style={{ fontFamily: 'var(--gf-font-display)', fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.03em' }}>{members}</div>
            <div className="sub">active members at {gym.name}</div>
          </div>
        </div>
      </section>
    </>
  );
}
