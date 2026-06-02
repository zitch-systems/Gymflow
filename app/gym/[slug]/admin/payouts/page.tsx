import { requireManager } from '@/lib/auth/gym';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira, fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { EmptyState } from '@/components/ui/empty-state';
import { BanknoteArrowUp, Hourglass, BanknoteX } from 'lucide-react';
import { ProcessPayoutForm } from './process-payout-form';

type PageProps = { params: Promise<{ slug: string }> };

// instructor_payouts has the new bank_*/paystack_* columns from
// 20260529_instructor_payouts_*.sql which aren't in the generated types
// yet. Locally type the row shape so the page can render them.
type PayoutRow = {
  id: string;
  amount: number;
  status: string;
  requested_at: string;
  processed_at: string | null;
  notes: string | null;
  instructor_id: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  paystack_transfer_code: string | null;
  profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};

export default async function AdminPayoutsPage({ params }: PageProps) {
  const { slug } = await params;
  // Admins-only (manager+) — payouts move real money.
  const { gym } = await requireManager(slug);
  // Service-role for the same reason as processPayout: needs to read the
  // new columns + bypass per-instructor RLS to surface every queued row.
  const admin = createAdminClient();

  const { data } = await admin
    .from('instructor_payouts')
    .select(
      'id, amount, status, requested_at, processed_at, notes, instructor_id, bank_code, bank_name, account_number, account_name, paystack_transfer_code, profiles:instructor_id(full_name, email)' as never,
    )
    .eq('gym_id', gym.id)
    .order('requested_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as PayoutRow[];

  const pendingRows = rows.filter((p) => p.status === 'requested');
  const otherRows = rows.filter((p) => p.status !== 'requested');

  // Pre-fill source #1 (preferred): the coach's saved bank account. Read via
  // service-role because instructor_bank_details is owner-readable only and
  // the admin is not the owner. Scoped to just the coaches with pending
  // payouts so we don't pull every coach's account.
  const pendingInstructorIds = [...new Set(pendingRows.map((r) => r.instructor_id))];
  const bankByInstructor = new Map<string, { bank_code: string; bank_name: string; account_number: string }>();
  if (pendingInstructorIds.length > 0) {
    const { data: bankRows } = await admin
      .from('instructor_bank_details' as never)
      .select('instructor_id, bank_code, bank_name, account_number')
      .in('instructor_id' as never, pendingInstructorIds);
    for (const b of (bankRows ?? []) as unknown as {
      instructor_id: string;
      bank_code: string;
      bank_name: string;
      account_number: string;
    }[]) {
      bankByInstructor.set(b.instructor_id, {
        bank_code: b.bank_code,
        bank_name: b.bank_name,
        account_number: b.account_number,
      });
    }
  }

  // Pre-fill source #2 (fallback): the most recent prior payout that already
  // carried bank details. Used only when the coach hasn't saved an account.
  const lastBankByInstructor = new Map<string, { bank_code: string; bank_name: string; account_number: string }>();
  for (const r of rows) {
    if (r.bank_code && r.bank_name && r.account_number && !lastBankByInstructor.has(r.instructor_id)) {
      lastBankByInstructor.set(r.instructor_id, {
        bank_code: r.bank_code,
        bank_name: r.bank_name,
        account_number: r.account_number,
      });
    }
  }

  const totals = rows.reduce(
    (acc, p) => {
      if (p.status === 'paid') acc.paid += Number(p.amount);
      else if (p.status === 'rejected') acc.rejected += Number(p.amount);
      else acc.pending += Number(p.amount);
      return acc;
    },
    { paid: 0, pending: 0, rejected: 0 },
  );

  return (
    <div className="gf-page">
      <PageHeader
        title="Instructor payouts"
        subtitle={`${pendingRows.length} awaiting action · ${rows.length} total`}
      />

      <StatGrid>
        <Stat label="Pending" value={fmtNaira(totals.pending)} icon={Hourglass} accent="amber" />
        <Stat label="Paid (lifetime)" value={fmtNaira(totals.paid)} icon={BanknoteArrowUp} accent="emerald" />
        <Stat label="Rejected" value={fmtNaira(totals.rejected)} icon={BanknoteX} accent="rose" />
      </StatGrid>

      <Card>
        <header className="gf-card-header"><h2 className="gf-card-title">Awaiting action</h2></header>
        {pendingRows.length === 0 ? (
          <EmptyState title="No pending payouts" message="When a coach requests a payout, it'll show up here." />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Coach</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((p) => {
                  const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
                  // Prefer the coach's saved bank account; fall back to the
                  // last payout's snapshot if they never saved one.
                  const prefill = bankByInstructor.get(p.instructor_id) ?? lastBankByInstructor.get(p.instructor_id);
                  return (
                    <tr key={p.id}>
                      <td>{fmtDateTime(p.requested_at)}</td>
                      <td data-label="Coach">
                        <div style={{ fontWeight: 600 }}>{profile?.full_name ?? '—'}</div>
                        <div className="gf-table-meta">{profile?.email ?? '—'}</div>
                      </td>
                      <td data-label="Amount" style={{ fontWeight: 600 }}>{fmtNaira(p.amount)}</td>
                      <td className="gf-table-meta" data-label="Note">{p.notes ?? '—'}</td>
                      <td>
                        <ProcessPayoutForm
                          slug={slug}
                          payoutId={p.id}
                          amount={Number(p.amount)}
                          coachName={profile?.full_name ?? profile?.email ?? 'coach'}
                          prefill={prefill}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <header className="gf-card-header"><h2 className="gf-card-title">History</h2></header>
        {otherRows.length === 0 ? (
          <EmptyState title="No processed payouts yet" message="" />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Coach</th>
                  <th>Amount</th>
                  <th>Bank</th>
                  <th>Status</th>
                  <th>Processed</th>
                </tr>
              </thead>
              <tbody>
                {otherRows.map((p) => {
                  const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
                  return (
                    <tr key={p.id}>
                      <td>{fmtDateTime(p.requested_at)}</td>
                      <td data-label="Coach">
                        <div style={{ fontWeight: 600 }}>{profile?.full_name ?? '—'}</div>
                        <div className="gf-table-meta">{profile?.email ?? '—'}</div>
                      </td>
                      <td data-label="Amount">{fmtNaira(p.amount)}</td>
                      <td className="gf-table-meta" data-label="Bank">
                        {p.bank_name ? (
                          <>
                            {p.bank_name}
                            <br />
                            <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 }}>
                              ••••{p.account_number?.slice(-4) ?? '----'}
                            </span>
                          </>
                        ) : '—'}
                      </td>
                      <td data-label="Status">
                        <span className={`status-pill ${p.status === 'paid' ? 'on' : p.status === 'rejected' ? 'off' : ''}`}>
                          {p.status}
                        </span>
                      </td>
                      <td data-label="Processed">{p.processed_at ? fmtDateTime(p.processed_at) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
