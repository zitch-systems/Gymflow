import { Wallet, ScanLine, Users, CreditCard } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';

export const metadata = { title: 'Analytics' };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAN_COLORS = ['#11d18b', '#4080ff', '#c6f24e', '#ffb020', '#b67bf3'];

// Revenue analytics are finance-only — the nav hides this item from front desk
// (admin-shell FINANCE), so gate the page the same way instead of a bare
// requireStaff() that would let front desk open it by direct URL. Mirrors the
// billing page's gate.
const FINANCE_ROLES = ['gym_owner', 'owner', 'manager', 'accountant'] as const;

export default async function AdminAnalytics() {
  const { gym } = await requireStaff(FINANCE_ROLES);
  const supabase = await createClient();

  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000).toISOString();
  const d7 = new Date(now - 7 * 86_400_000);

  const [{ data: pay30 }, { data: checkins }, { data: activeSubs }, { data: plans }, { count: members }] = await Promise.all([
    supabase.from('payments').select('amount, payment_status, payment_date').eq('gym_id', gym.id).eq('payment_status', 'successful').gte('payment_date', new Date(now - 42 * 86_400_000).toISOString()),
    supabase.from('check_ins').select('checked_in_at').eq('gym_id', gym.id).gte('checked_in_at', d7.toISOString()),
    supabase.from('member_subscriptions').select('plan_id').eq('gym_id', gym.id).eq('status', 'active'),
    supabase.from('membership_plans').select('id, name').eq('gym_id', gym.id),
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('is_active', true),
  ]);

  const revenue30 = (pay30 ?? []).filter((p) => (p.payment_date ?? '') >= d30).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Revenue by week (last 6 weeks).
  const weeks = Array.from({ length: 6 }, (_, i) => ({ label: `W${i + 1}`, amount: 0 }));
  for (const p of pay30 ?? []) {
    if (!p.payment_date) continue;
    const wk = Math.floor((now - new Date(p.payment_date).getTime()) / (7 * 86_400_000));
    if (wk >= 0 && wk < 6) weeks[5 - wk].amount += Number(p.amount ?? 0);
  }
  const wkMax = Math.max(1, ...weeks.map((w) => w.amount));
  // Total across the 6 weekly bars — the panel label reflects the chart's own
  // window (was mislabeled "in 30 days" over this 6-week / 42-day chart, while the
  // 30-day figure lives on the "Revenue (30d)" KPI above).
  const revenue6w = weeks.reduce((s, w) => s + w.amount, 0);

  // Check-ins by day (last 7).
  const byDay = Array.from({ length: 7 }, (_, i) => { const d = new Date(now - (6 - i) * 86_400_000); return { label: DOW[d.getDay()], n: 0 }; });
  for (const c of checkins ?? []) {
    if (!c.checked_in_at) continue;
    const idx = 6 - Math.floor((now - new Date(c.checked_in_at).getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) byDay[idx].n += 1;
  }
  const dayMax = Math.max(1, ...byDay.map((d) => d.n));

  // Plan mix from active subscriptions.
  const planName = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const counts = new Map<string, number>();
  for (const s of activeSubs ?? []) { const k = s.plan_id ?? 'none'; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const totalSubs = (activeSubs ?? []).length;
  const mix = [...counts.entries()].map(([id, n], i) => ({ label: planName.get(id) ?? 'Other', pct: totalSubs ? Math.round((n / totalSubs) * 100) : 0, color: PLAN_COLORS[i % PLAN_COLORS.length] }));
  let acc = 0;
  const donutStops = mix.map((m) => { const from = acc; acc += m.pct; return `${m.color} ${from}% ${acc}%`; }).join(', ');
  const donut = mix.length ? `conic-gradient(${donutStops})` : 'var(--gf-elevated)';

  const KPIS = [
    { icon: Wallet, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(revenue30), lbl: 'Revenue (30d)' },
    { icon: ScanLine, fg: '#4080ff', bg: '#4080ff1f', val: String((checkins ?? []).length), lbl: 'Check-ins (7d)' },
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(members ?? 0), lbl: 'Active members' },
    { icon: CreditCard, fg: '#ffb020', bg: '#ffb0201f', val: String(totalSubs), lbl: 'Active subs' },
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

      <section className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
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
            <div style={{ fontFamily: 'var(--gf-font-display)', fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.03em' }}>{members ?? 0}</div>
            <div className="sub">active members at {gym.name}</div>
          </div>
        </div>
      </section>
    </>
  );
}
