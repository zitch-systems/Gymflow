import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDateTime, fmtDate } from '@/lib/format';
import { daysAgoDate, todayDate } from '@/lib/dates';
import { WalletFilters } from './wallet-filters';
import { ExportPaymentsCsvButton } from './export-csv-button';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { BanknoteArrowUp, Hourglass, BanknoteX } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; method?: string; status?: string }>;
};

const DAY_MS = 86_400_000;

export default async function AdminWalletPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { gym } = await requireStaff(slug);

  const defaultFrom = daysAgoDate(30);
  const defaultTo = todayDate();
  const from = sp.from || defaultFrom;
  const to = sp.to || defaultTo;
  const method = sp.method ?? '';
  const status = sp.status ?? '';

  const supabase = await createClient();
  let q = supabase
    .from('payments')
    .select('id, payment_date, payment_method, payment_status, amount, currency, paystack_reference, member_id, plan_id, profiles:member_id(full_name, email), membership_plans:plan_id(name)')
    .eq('gym_id', gym.id)
    .gte('payment_date', new Date(from).toISOString())
    .lte('payment_date', new Date(new Date(to).getTime() + DAY_MS).toISOString())
    .order('payment_date', { ascending: false })
    .limit(500);
  if (method) q = q.eq('payment_method', method);
  if (status) q = q.eq('payment_status', status);
  const { data: rows } = await q;

  const totals = (rows ?? []).reduce(
    (acc, p) => {
      if (p.payment_status === 'successful') acc.success += Number(p.amount);
      else if (p.payment_status === 'failed') acc.failed += Number(p.amount);
      else acc.pending += Number(p.amount);
      return acc;
    },
    { success: 0, failed: 0, pending: 0 },
  );

  return (
    <div className="gf-page">
      <PageHeader
        title="Wallet & payments"
        subtitle={`${fmtDate(from)} → ${fmtDate(to)} · ${rows?.length ?? 0} transaction(s)`}
        actions={<ExportPaymentsCsvButton slug={slug} from={from} to={to} method={method || undefined} status={status || undefined} />}
      />

      <StatGrid>
        <Stat label="Settled" value={fmtNaira(totals.success)} icon={BanknoteArrowUp} accent="emerald" />
        <Stat label="Pending" value={fmtNaira(totals.pending)} icon={Hourglass} accent="amber" />
        <Stat label="Failed" value={fmtNaira(totals.failed)} icon={BanknoteX} accent="rose" />
      </StatGrid>

      <Card>
        <WalletFilters defaultFrom={from} defaultTo={to} defaultMethod={method} defaultStatus={status} />
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Member</th>
                <th>Plan</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((p) => {
                const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
                const plan = Array.isArray(p.membership_plans) ? p.membership_plans[0] : p.membership_plans;
                return (
                  <tr key={p.id}>
                    <td>{p.payment_date ? fmtDateTime(p.payment_date) : '—'}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{profile?.full_name ?? '—'}</div>
                      <div className="gf-table-meta">{profile?.email ?? '—'}</div>
                    </td>
                    <td>{plan?.name ?? '—'}</td>
                    <td>{p.payment_method ?? '—'}</td>
                    <td className="gf-table-meta" style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 }}>
                      {p.paystack_reference?.slice(0, 14) ?? '—'}
                    </td>
                    <td>{fmtNaira(p.amount)}</td>
                    <td>
                      <span className={`status-pill ${p.payment_status === 'successful' ? 'on' : 'off'}`}>
                        {p.payment_status ?? '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
