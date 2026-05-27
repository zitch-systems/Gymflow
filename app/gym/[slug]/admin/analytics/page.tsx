import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { PrintAnalyticsButton } from './print-button';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Users, BadgeCheck, CalendarCheck, BookOpenCheck } from 'lucide-react';

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
      <PageHeader
        title="Analytics"
        subtitle={`${gym.name} · last 30 days`}
        actions={<PrintAnalyticsButton />}
      />

      <StatGrid>
        <Stat label="Total members" value={totalMembers ?? 0} icon={Users} accent="emerald" />
        <Stat label="Active subscriptions" value={activeMemberships ?? 0} icon={BadgeCheck} accent="blue" />
        <Stat label="Check-ins (30d)" value={checkInsLast30 ?? 0} icon={CalendarCheck} accent="amber" />
        <Stat label="Bookings (30d)" value={bookingsLast30 ?? 0} icon={BookOpenCheck} accent="purple" />
      </StatGrid>

      <Card>
        <CardHeader title="Revenue" />
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
      </Card>

      <Card>
        <CardHeader title="Revenue vs expenses · last 6 months" />
        <div className="gf-trend">
          <div className="gf-trend-legend">
            <span><i className="gf-trend-key gf-trend-key-rev" /> Revenue</span>
            <span><i className="gf-trend-key gf-trend-key-exp" /> Expenses</span>
          </div>
          <div className="gf-trend-chart">
            {(() => {
              const trendMax = Math.max(1, ...pnlRows.map((r) => Math.max(r.revenue, r.expense)));
              return pnlRows.map((r) => (
                <div key={r.key} className="gf-trend-group" title={`${r.label}: ${fmtNaira(r.revenue)} in / ${fmtNaira(r.expense)} out`}>
                  <div className="gf-trend-bars">
                    <div className="gf-trend-bar gf-trend-bar-rev" style={{ height: `${(r.revenue / trendMax) * 100}%` }} />
                    <div className="gf-trend-bar gf-trend-bar-exp" style={{ height: `${(r.expense / trendMax) * 100}%` }} />
                  </div>
                  <span className="gf-trend-label">{r.label}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Profit & loss · last 6 months" />
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
      </Card>

      <Card>
        <CardHeader title="Check-ins · last 7 days" />
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
      </Card>
    </div>
  );
}
