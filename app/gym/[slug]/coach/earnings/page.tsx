import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { PayoutRequestForm } from './payout-request-form';

type PageProps = { params: Promise<{ slug: string }> };

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
    <div className="member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Earnings</h1>
          <p className="gf-page-subtitle">{sharePct}% revenue share with {gym.name}</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="member-quick-actions" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>This month</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4 }}>₦{monthShare.toLocaleString('en-NG')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', marginTop: 2 }}>of ₦{month.toLocaleString('en-NG')} gross</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lifetime</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4 }}>₦{lifetimeShare.toLocaleString('en-NG')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', marginTop: 2 }}>of ₦{lifetime.toLocaleString('en-NG')} gross</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Available</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4, color: 'var(--gf-brand)' }}>₦{available.toLocaleString('en-NG')}</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending payout</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4 }}>₦{pending.toLocaleString('en-NG')}</div>
        </div>
      </section>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Request a payout</h2></header>
        <PayoutRequestForm slug={slug} max={available} />
      </section>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Payout history</h2></header>
        {payouts && payouts.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead><tr><th>Requested</th><th>Amount</th><th>Status</th><th>Processed</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.requested_at)}</td>
                    <td>₦{Number(p.amount).toLocaleString('en-NG')}</td>
                    <td><span className={`status-pill ${p.status === 'paid' ? 'on' : p.status === 'rejected' ? 'off' : ''}`}>{p.status}</span></td>
                    <td>{p.processed_at ? fmtDate(p.processed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 18, color: 'var(--gf-text-muted)' }}>No payout requests yet.</div>
        )}
      </section>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Recent subscription revenue</h2></header>
        {allSubs && allSubs.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {allSubs.slice(0, 10).map((r, i) => {
              const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              return (
                <li key={i} style={{ padding: '10px 18px', borderTop: '1px solid var(--gf-border)', display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{p?.full_name ?? p?.email ?? 'Member'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)' }}>{r.created_at ? fmtDate(r.created_at) : '—'}</div>
                  </div>
                  <div style={{ fontWeight: 600 }}>₦{Number(r.amount_paid ?? 0).toLocaleString('en-NG')}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div style={{ padding: 18, color: 'var(--gf-text-muted)' }}>No subscription revenue yet.</div>
        )}
      </section>
    </div>
  );
}
