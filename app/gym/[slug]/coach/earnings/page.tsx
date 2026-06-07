import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtNaira } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { Stat } from '@/components/ui/stat';
import { Wallet, CalendarCheck, TrendingUp, Hourglass, Receipt, Banknote } from 'lucide-react';
import { PayoutRequestForm } from './payout-request-form';

type PageProps = { params: Promise<{ slug: string }> };

function payoutStatusLabel(status: string): string {
  switch (status) {
    case 'requested': return 'Awaiting admin';
    case 'approved':  return 'Sent · settling';
    case 'paid':      return 'Paid';
    case 'rejected':  return 'Rejected';
    default:          return status;
  }
}

function payoutBadgeClass(status: string): string {
  switch (status) {
    case 'paid':     return 'gf-badge-success';
    case 'approved': return 'gf-badge-info';
    case 'rejected': return 'gf-badge-danger';
    default:         return 'gf-badge-warning';
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
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const lifetime = (allSubs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const month = (allSubs ?? []).filter((r) => new Date(r.created_at ?? 0) >= monthStart).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const lastMonth = (allSubs ?? [])
    .filter((r) => {
      const d = new Date(r.created_at ?? 0);
      return d >= lastMonthStart && d < monthStart;
    })
    .reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);

  const lifetimeShare = Math.round((lifetime * sharePct) / 100);
  const monthShare = Math.round((month * sharePct) / 100);
  const lastMonthShare = Math.round((lastMonth * sharePct) / 100);
  const paidOut = (payouts ?? []).filter((p) => p.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const pending = (payouts ?? []).filter((p) => p.status === 'requested' || p.status === 'approved').reduce((s, r) => s + Number(r.amount), 0);
  const available = Math.max(lifetimeShare - paidOut - pending, 0);

  const sessionsThisMonth = (allSubs ?? []).filter((r) => new Date(r.created_at ?? 0) >= monthStart).length;
  const vsLastMonth = lastMonthShare > 0 ? Math.round(((monthShare - lastMonthShare) / lastMonthShare) * 100) : 0;
  const monthLabel = monthStart.toLocaleDateString('en-NG', { month: 'long' });

  return (
    <div className="gf-page">
      <header className="hdr">
        <div>
          <h1>Earnings</h1>
          <p>{monthLabel} · {fmtNaira(monthShare)} earned · {sharePct}% share</p>
        </div>
        <Link href="/coach/profile" className="icon-btn" aria-label="Profile">
          <span>C</span>
        </Link>
      </header>

      <section className="kpis">
        <Stat
          label="This month"
          value={fmtNaira(monthShare)}
          accent="emerald"
          icon={Wallet}
          delta={lastMonthShare > 0 ? { dir: vsLastMonth >= 0 ? 'up' : 'down', value: `${vsLastMonth >= 0 ? '+' : ''}${vsLastMonth}%` } : undefined}
        />
        <Stat label="Sessions (mo)" value={sessionsThisMonth} accent="blue" icon={CalendarCheck} />
        <Stat label="Available" value={fmtNaira(available)} accent="lime" icon={TrendingUp} />
        <Stat label="Pending payout" value={fmtNaira(pending)} accent="amber" icon={Hourglass} />
      </section>

      <div className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Payout history</h3>
                <div className="sub">Bank transfers to your account · last 20</div>
              </div>
            </div>
            {payouts && payouts.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id}>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(p.requested_at)}</td>
                      <td className="naira">{fmtNaira(Number(p.amount))}</td>
                      <td>
                        <span className={`gf-badge ${payoutBadgeClass(p.status)}`}>
                          <span className="gf-dot" />
                          {payoutStatusLabel(p.status)}
                        </span>
                      </td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{p.processed_at ? fmtDate(p.processed_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={Wallet} title="No payout requests yet" message="Request a payout once you have available earnings." />
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Request a payout</h3>
                <div className="sub">Available: {fmtNaira(available)}</div>
              </div>
            </div>
            <PayoutRequestForm slug={slug} max={available} />
          </div>

          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Recent revenue</h3>
                <div className="sub">Subscriptions to your coaching · last 10</div>
              </div>
            </div>
            {allSubs && allSubs.length > 0 ? (
              <div className="feed">
                {allSubs.slice(0, 10).map((r, i) => {
                  const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
                  const name = p?.full_name ?? p?.email ?? 'Member';
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <div key={i} className="feed-row">
                      <span className="gf-avatar gf-avatar-sm" aria-hidden>{initial}</span>
                      <span className="feed-meta">
                        <strong>{name}</strong>
                        <small>{r.created_at ? fmtDate(r.created_at) : '—'}</small>
                      </span>
                      <span className="feed-time naira" style={{ color: 'var(--gf-success)' }}>+{fmtNaira(Number(r.amount_paid ?? 0))}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Receipt} title="No revenue yet" message="Member subscriptions to you will show up here." />
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, fontSize: '0.74rem', color: 'var(--gf-text-muted)', textAlign: 'center' }}>
        <Banknote size={12} strokeWidth={1.75} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
        Lifetime: {fmtNaira(lifetimeShare)} earned · {fmtNaira(paidOut)} paid out
      </div>
    </div>
  );
}
