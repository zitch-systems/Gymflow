import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, fmtDateTime } from '@/lib/format';
import { daysAgoDate, todayDate } from '@/lib/dates';
import { WalletFilters } from './wallet-filters';
import { ExportPaymentsCsvButton } from './export-csv-button';
import { Stat } from '@/components/ui/stat';
import { CreditCard, BanknoteArrowUp, Hourglass, BanknoteX } from 'lucide-react';

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
      const amt = Number(p.amount ?? 0);
      if (p.payment_status === 'successful') acc.success += amt;
      else if (p.payment_status === 'failed') acc.failed += amt;
      else acc.pending += amt;
      acc.count += 1;
      return acc;
    },
    { success: 0, failed: 0, pending: 0, count: 0 },
  );

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Wallet</h1>
          <p>{gym.name} · settlements via Paystack · {fmtDate(from)} → {fmtDate(to)}</p>
        </div>
        <ExportPaymentsCsvButton slug={slug} from={from} to={to} method={method || undefined} status={status || undefined} />
      </div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat label="Collected" value={fmtNaira(totals.success)} icon={BanknoteArrowUp} accent="emerald" />
        <Stat label="Pending" value={fmtNaira(totals.pending)} icon={Hourglass} accent="amber" />
        <Stat label="Failed" value={fmtNaira(totals.failed)} icon={BanknoteX} accent="rose" />
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Transactions</h3>
            <div className="sub">{totals.count} payment{totals.count === 1 ? '' : 's'} · {fmtNaira(totals.success + totals.pending + totals.failed)} gross</div>
          </div>
        </div>
        <WalletFilters defaultFrom={from} defaultTo={to} defaultMethod={method} defaultStatus={status} />

        <table className="tbl">
          <thead>
            <tr>
              <th>Description</th>
              <th>Method</th>
              <th>Date</th>
              <th>Reference</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p) => {
              const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
              const plan = Array.isArray(p.membership_plans) ? p.membership_plans[0] : p.membership_plans;
              const memberName = profile?.full_name ?? '—';
              const initial = (memberName === '—' ? '?' : memberName.charAt(0)).toUpperCase();
              const success = p.payment_status === 'successful';
              const pending = p.payment_status === 'pending';
              const badge = success
                ? { cls: 'gf-badge-success', label: 'Settled' }
                : pending
                  ? { cls: 'gf-badge-warning', label: 'Pending' }
                  : { cls: 'gf-badge-danger', label: p.payment_status ?? 'Failed' };
              return (
                <tr key={p.id}>
                  <td>
                    <div className="who">
                      <span className="gf-avatar gf-avatar-sm" style={{ background: success ? 'var(--gf-success-soft)' : pending ? 'var(--gf-warning-soft)' : 'var(--gf-danger-soft)', color: success ? 'var(--gf-success)' : pending ? 'var(--gf-warning)' : 'var(--gf-danger)', borderColor: 'transparent' }}>
                        <CreditCard size={14} strokeWidth={2} />
                      </span>
                      <div>
                        <strong>{plan?.name ?? 'Payment'} · {memberName}</strong>
                        <small>{profile?.email ?? `Member ${initial}`}</small>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{p.payment_method ?? 'Paystack'}</td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{p.payment_date ? fmtDateTime(p.payment_date) : '—'}</td>
                  <td style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: 'var(--gf-text-muted)' }}>
                    {p.paystack_reference?.slice(0, 14) ?? '—'}
                  </td>
                  <td>
                    <span className={`gf-badge ${badge.cls}`}>
                      <span className="gf-dot" />
                      {badge.label}
                    </span>
                  </td>
                  <td className="naira" style={{ textAlign: 'right', color: success ? 'var(--gf-success)' : 'var(--gf-text)' }}>
                    {success ? '+' : ''}{fmtNaira(p.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
