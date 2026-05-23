import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

type PageProps = { params: Promise<{ slug: string }> };

const DAY_MS = 86_400_000;

export default async function AdminAnalyticsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const now = new Date();
  const startOf30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [
    { count: totalMembers },
    { count: activeMemberships },
    { count: checkInsLast30 },
    { count: bookingsLast30 },
    { data: payments30 },
    { data: paymentsMonth },
    { data: dailyCheckIns },
    { data: paymentsForPnl },
    { data: expensesForPnl },
  ] = await Promise.all([
    supabase.from('gym_member_links').select('*', { count: 'exact', head: true }).eq('gym_id', gym.id),
    supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .gte('end_date', now.toISOString().split('T')[0]),
    supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('checked_in_at', startOf30),
    supabase
      .from('class_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('booked_at', startOf30),
    supabase
      .from('payments')
      .select('amount, payment_date')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', startOf30),
    supabase
      .from('payments')
      .select('amount')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', startOfMonth),
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('gym_id', gym.id)
      .gte('checked_in_at', new Date(now.getTime() - 7 * DAY_MS).toISOString()),
    supabase
      .from('payments')
      .select('amount, payment_date')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', sixMonthsAgo),
    supabase
      .from('expenses')
      .select('amount, expense_date')
      .eq('gym_id', gym.id)
      .gte('expense_date', sixMonthsAgo.split('T')[0]),
  ]);

  const revenue30 = (payments30 ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const revenueMonth = (paymentsMonth ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  // Build last 6 months of P&L
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = (key: string) => {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
  };
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(monthKey(d));
  }
  const revenueByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  const expenseByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const p of paymentsForPnl ?? []) {
    if (!p.payment_date) continue;
    const k = monthKey(new Date(p.payment_date));
    if (k in revenueByMonth) revenueByMonth[k] += Number(p.amount ?? 0);
  }
  for (const e of expensesForPnl ?? []) {
    if (!e.expense_date) continue;
    const k = monthKey(new Date(e.expense_date));
    if (k in expenseByMonth) expenseByMonth[k] += Number(e.amount ?? 0);
  }
  const pnlRows = months.map((k) => ({
    key: k,
    label: monthLabel(k),
    revenue: revenueByMonth[k],
    expense: expenseByMonth[k],
    net: revenueByMonth[k] - expenseByMonth[k],
  }));

  const dailyBuckets: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    dailyBuckets[d.toISOString().split('T')[0]] = 0;
  }
  for (const c of dailyCheckIns ?? []) {
    if (!c.checked_in_at) continue;
    const day = c.checked_in_at.split('T')[0];
    if (day in dailyBuckets) dailyBuckets[day]++;
  }
  const dayMax = Math.max(1, ...Object.values(dailyBuckets));

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Analytics</h1>
          <p className="gf-page-subtitle">{gym.name} · last 30 days</p>
        </div>
      </header>

      <section className="gf-kpi-grid">
        <Kpi label="Total members" value={String(totalMembers ?? 0)} accent="emerald" />
        <Kpi label="Active subscriptions" value={String(activeMemberships ?? 0)} accent="blue" />
        <Kpi label="Check-ins (30d)" value={String(checkInsLast30 ?? 0)} accent="amber" />
        <Kpi label="Bookings (30d)" value={String(bookingsLast30 ?? 0)} accent="purple" />
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Revenue</h2>
        </header>
        <dl className="gf-detail-list">
          <div>
            <dt>This month</dt>
            <dd>{fmtNaira(revenueMonth)}</dd>
          </div>
          <div>
            <dt>Last 30 days</dt>
            <dd>{fmtNaira(revenue30)}</dd>
          </div>
        </dl>
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Profit &amp; loss · last 6 months</h2>
        </header>
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {pnlRows.map((r) => (
                <tr key={r.key}>
                  <td style={{ fontWeight: 600 }}>{r.label}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNaira(r.revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNaira(r.expense)}</td>
                  <td style={{ textAlign: 'right', color: r.net >= 0 ? 'var(--gf-brand)' : 'var(--gf-danger)', fontWeight: 600 }}>
                    {fmtNaira(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Check-ins · last 7 days</h2>
        </header>
        <div className="gf-bars">
          {Object.entries(dailyBuckets).map(([day, count]) => (
            <div key={day} className="gf-bar-row">
              <span className="gf-bar-label">{fmtDate(day)}</span>
              <div className="gf-bar-track">
                <div className="gf-bar-fill" style={{ width: `${(count / dayMax) * 100}%` }} />
              </div>
              <span className="gf-bar-value">{count}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: 'emerald' | 'blue' | 'amber' | 'purple' }) {
  return (
    <div className={`gf-kpi gf-kpi-${accent}`}>
      <div className="gf-kpi-value">{value}</div>
      <div className="gf-kpi-label">{label}</div>
    </div>
  );
}
