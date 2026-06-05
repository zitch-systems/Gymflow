import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';
import { Wallet, CreditCard, Repeat, Receipt, ChevronRight, Bell } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

const STATUS_LABEL: Record<string, string> = {
  successful: 'Successful',
  failed: 'Failed',
  pending: 'Pending',
  refunded: 'Refunded',
};

export default async function WalletPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  const [{ data: payments }, { data: subscription }, { data: plans }, { count: unreadRaw }] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount, payment_date, created_at, payment_status, payment_method, plan_id')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('member_subscriptions')
      .select('end_date, status')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('membership_plans').select('id, name').eq('gym_id', gym.id),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('gym_id', gym.id)
      .eq('is_read', false),
  ]);
  const unreadCount = unreadRaw ?? 0;

  const planName = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const eff = (p: { payment_date: string | null; created_at: string | null }) => p.payment_date ?? p.created_at;

  const txns = [...(payments ?? [])].sort((a, b) => (Date.parse(eff(b) ?? '') || 0) - (Date.parse(eff(a) ?? '') || 0));
  const successful = txns.filter((p) => p.payment_status === 'successful');
  const totalSpent = successful.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Membership context for the hero — real subscription, not a stored balance.
  const remaining = subscription?.end_date ? daysLeft(subscription.end_date) : 0;
  const membershipLine = remaining > 0
    ? `Membership renews ${fmtDate(subscription!.end_date)}`
    : subscription
      ? 'Membership expired — renew to keep training'
      : 'No active membership';

  // Spend over the last 6 calendar months (successful payments, UTC buckets).
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-NG', { month: 'short', timeZone: 'UTC' }),
    };
  });
  const spendByMonth = new Map<string, number>();
  for (const p of successful) {
    const e = eff(p);
    if (!e) continue;
    const d = new Date(e);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    spendByMonth.set(k, (spendByMonth.get(k) ?? 0) + Number(p.amount ?? 0));
  }
  const monthSeries = months.map((m) => ({ ...m, amount: spendByMonth.get(m.key) ?? 0 }));
  const monthMax = Math.max(1, ...monthSeries.map((m) => m.amount));
  const thisMonthSpend = monthSeries[monthSeries.length - 1].amount;

  return (
    <div className="member-portal member-app">
      <header className="m-head" style={{ paddingBottom: 10 }}>
        <strong className="htitle">Wallet</strong>
        <Link
          href="/dashboard/inbox"
          className="m-head-bell"
          aria-label={unreadCount > 0 ? `Inbox · ${unreadCount} unread` : 'Inbox'}
          style={{ marginLeft: 'auto' }}
        >
          <Bell size={18} strokeWidth={1.9} />
          {unreadCount > 0 ? (
            <span className="m-head-bell-badge" aria-hidden>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Link>
      </header>

      {/* Headline = real lifetime spend, not a stored-value balance — GymFlow
          isn't a wallet-float product. Prototype's "Top up" button is omitted
          for the same reason. */}
      <div className="m-wcard">
        <div className="m-wcard-label"><Wallet strokeWidth={1.9} /> Total spent</div>
        <div className="m-wcard-bal">{fmtNaira(totalSpent)}</div>
        <div className="m-wcard-sub"><Repeat strokeWidth={1.9} /> {membershipLine}</div>
        <div className="m-wcard-btns">
          <Link href="/dashboard/renew" className="b-primary"><CreditCard strokeWidth={2} /> Renew plan</Link>
        </div>
      </div>

      {successful.length > 0 && (
        <div className="m-spend">
          <div className="m-spend-h">
            <div><b>{fmtNaira(thisMonthSpend)}</b> <small>spent this month</small></div>
            <small>Last 6 months</small>
          </div>
          <div className="m-spend-bars" role="img" aria-label={`Monthly spend, ${fmtNaira(totalSpent)} total`}>
            {monthSeries.map((m, i) => (
              <div key={m.key} className={`m-spend-col${i === monthSeries.length - 1 ? ' now' : ''}`} title={`${m.label}: ${fmtNaira(m.amount)}`}>
                <div className="bv" style={{ height: `${Math.round((m.amount / monthMax) * 100)}%` }} />
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="m-wallet-sect">Transactions</div>
      {txns.length > 0 ? (
        <div className="m-wallet-group">
          {txns.map((p) => {
            const failed = p.payment_status !== 'successful' && p.payment_status !== 'pending';
            const method = p.payment_method || 'Paystack';
            return (
              <Link key={p.id} href={`/dashboard/wallet/${p.id}`} className="m-txn">
                <span className={`m-txn-ic${failed ? ' failed' : ''}`}><CreditCard /></span>
                <span className="m-txn-m">
                  <strong>{(p.plan_id && planName.get(p.plan_id)) || 'Membership payment'}</strong>
                  <small>{fmtDate(eff(p))} · {method}</small>
                </span>
                <span className={`m-txn-amt${failed ? ' failed' : ''}`}>
                  {fmtNaira(Number(p.amount ?? 0))}
                  <small>{STATUS_LABEL[p.payment_status ?? ''] ?? (p.payment_status || '—')}</small>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="m-wallet-group" style={{ padding: '32px 16px', textAlign: 'center' }}>
          <Receipt size={26} strokeWidth={1.6} style={{ color: 'var(--gf-text-muted)', marginBottom: 8 }} />
          <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.86rem', margin: '0 0 14px' }}>
            No payments yet. Your renewals and purchases will show here.
          </p>
          <Link href="/dashboard/renew" className="gf-btn gf-btn-primary gf-btn-sm">
            Renew membership <ChevronRight size={15} strokeWidth={2} />
          </Link>
        </div>
      )}
    </div>
  );
}
