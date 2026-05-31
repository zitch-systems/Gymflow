import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtNaira } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Wallet, Receipt } from 'lucide-react';
import { PayoutRequestForm } from './payout-request-form';

type PageProps = { params: Promise<{ slug: string }> };

// The DB stores raw payout states; coaches see plainer language. 'approved'
// means the admin has initiated the bank transfer and it's settling — the
// webhook flips it to 'paid' on transfer.success.
function payoutStatusLabel(status: string): string {
  switch (status) {
    case 'requested': return 'Awaiting admin';
    case 'approved':  return 'Sent · settling';
    case 'paid':      return 'Paid';
    case 'rejected':  return 'Rejected';
    default:          return status;
  }
}

export default async function CoachEarningsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const sharePct = gym.instructor_revenue_share_pct ?? 50;

  const [{ data: allSubs }, { data: payouts }] = await Promise.all([
    supabase
      .from('instructor_subscriptions')
      .select('amount_paid, created_at, status, profiles:member_id(full_name, email)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('instructor_payouts')
      .select('id, amount, status, requested_at, processed_at, notes')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .order('requested_at', { ascending: false })
      .limit(20),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lifetime = (allSubs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const month = (allSubs ?? []).filter((r) => new Date(r.created_at ?? 0) >= monthStart).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);

  const lifetimeShare = Math.round((lifetime * sharePct) / 100);
  const monthShare = Math.round((month * sharePct) / 100);
  const paidOut = (payouts ?? []).filter((p) => p.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const pending = (payouts ?? []).filter((p) => p.status === 'requested' || p.status === 'approved').reduce((s, r) => s + Number(r.amount), 0);
  const available = Math.max(lifetimeShare - paidOut - pending, 0);

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Earnings</h1>
          <p className="gf-page-subtitle">{sharePct}% revenue share with {gym.name}</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="mini-stat-grid">
        <div className="mini-stat">
          <div className="mini-stat-label">This month</div>
          <div className="mini-stat-value">{fmtNaira(monthShare)}</div>
          <div className="mini-stat-sub">of {fmtNaira(month)} gross</div>
        </div>
        <div className="mini-stat">
          <div className="mini-stat-label">Lifetime</div>
          <div className="mini-stat-value">{fmtNaira(lifetimeShare)}</div>
          <div className="mini-stat-sub">of {fmtNaira(lifetime)} gross</div>
        </div>
        <div className="mini-stat">
          <div className="mini-stat-label">Available</div>
          <div className="mini-stat-value is-brand">{fmtNaira(available)}</div>
        </div>
        <div className="mini-stat">
          <div className="mini-stat-label">Pending payout</div>
          <div className="mini-stat-value">{fmtNaira(pending)}</div>
        </div>
      </section>

      <Card>
        <CardHeader title="Request a payout" />
        <PayoutRequestForm slug={slug} max={available} />
      </Card>

      <Card>
        <CardHeader title="Payout history" />
        {payouts && payouts.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead><tr><th>Requested</th><th>Amount</th><th>Status</th><th>Processed</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.requested_at)}</td>
                    <td>{fmtNaira(Number(p.amount))}</td>
                    <td><span className={`status-pill ${p.status === 'paid' ? 'on' : p.status === 'rejected' ? 'off' : ''}`}>{payoutStatusLabel(p.status)}</span></td>
                    <td>{p.processed_at ? fmtDate(p.processed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Wallet} title="No payout requests yet" message="Request a payout once you have available earnings." />
        )}
      </Card>

      <Card>
        <CardHeader title="Recent subscription revenue" />
        {allSubs && allSubs.length > 0 ? (
          <div className="m-links" style={{ padding: 14 }}>
            {allSubs.slice(0, 10).map((r, i) => {
              const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              return (
                <div key={i} className="m-lc">
                  <div className="m-lc-m">
                    <strong>{p?.full_name ?? p?.email ?? 'Member'}</strong>
                    <small>{r.created_at ? fmtDate(r.created_at) : '—'}</small>
                  </div>
                  <span className="m-lc-time">{fmtNaira(Number(r.amount_paid ?? 0))}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Receipt} title="No subscription revenue yet" message="Member subscriptions to you will show up here." />
        )}
      </Card>
    </div>
  );
}
