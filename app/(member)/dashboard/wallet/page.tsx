import Link from 'next/link';
import { Bell, Wallet, Repeat, CreditCard, ChevronRight, ArrowDownLeft, Receipt } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';

export const metadata = { title: 'Wallet' };

const STATUS_LABEL: Record<string, string> = { successful: 'Successful', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' };

export default async function WalletPage() {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const [{ data: payments }, { data: sub }, { data: cards }, { count: unread }] = await Promise.all([
    supabase.from('payments')
      .select('id, amount, payment_status, payment_date, created_at, payment_method, plan_id')
      .eq('member_id', user.id).eq('gym_id', gym.id)
      .order('payment_date', { ascending: false }).limit(40),
    supabase.from('member_subscriptions')
      .select('end_date, plan_id, status, membership_plans(name)')
      .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
      .order('end_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('saved_cards')
      .select('id, brand, last4, exp_month, exp_year, bank, is_default')
      .eq('member_id', user.id).eq('gym_id', gym.id).eq('is_active', true)
      .order('is_default', { ascending: false }),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
  ]);

  const eff = (p: { payment_date: string | null; created_at: string | null }) => p.payment_date ?? p.created_at;
  const txns = payments ?? [];
  const successful = txns.filter((p) => p.payment_status === 'successful');
  const totalSpent = successful.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
  const planName = (sub as unknown as { membership_plans: { name: string } | null })?.membership_plans?.name ?? null;
  const unreadCount = unread ?? 0;

  // Last 6 months of successful spend (UTC buckets).
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    return { key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: d.toLocaleDateString('en-NG', { month: 'short', timeZone: 'UTC' }), amount: 0 };
  });
  for (const p of successful) {
    const e = eff(p); if (!e) continue;
    const d = new Date(e); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const m = months.find((mo) => mo.key === k); if (m) m.amount += Number(p.amount ?? 0);
  }
  const max = Math.max(1, ...months.map((m) => m.amount));
  const thisMonth = months[months.length - 1].amount;

  return (
    <section className="view on" data-v="wallet">
      <div className="mhead" style={{ paddingBottom: 10 }}>
        <strong className="htitle">Wallet</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} />{unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
      </div>

      <div className="wcard">
        <div className="wlabel"><Wallet strokeWidth={1.9} /> Total spent</div>
        <div className="wbal">{fmtNaira(totalSpent)}</div>
        <div className="wnext"><Repeat strokeWidth={1.9} /> {remaining > 0 ? `Renews ${fmtDate(sub!.end_date)}` : 'No active membership'}</div>
        <div className="wbtns">
          <Link href="/dashboard/renew" className="b-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none', borderRadius: 'var(--gf-radius-sm)', padding: 11, fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.84rem' }}><CreditCard strokeWidth={2} /> Renew plan</Link>
        </div>
      </div>

      {successful.length > 0 && (
        <div className="spend">
          <div className="sh"><div><b>{fmtNaira(thisMonth)}</b> <small>spent this month</small></div><small>Last 6 months</small></div>
          <div className="bars">
            {months.map((m, i) => (
              <div key={m.key} className={`bcol${i === months.length - 1 ? ' now' : ''}`}>
                <div className="bv" style={{ height: `${Math.round((m.amount / max) * 100)}%` }} /><span>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sect-t">Membership</div>
      <div className="group" style={{ marginBottom: 14 }}>
        <Link href="/dashboard/renew" className="row">
          <span className="ic"><CreditCard strokeWidth={1.9} /></span>
          <div className="m"><strong>Renew or change plan</strong><small>{planName ? `${planName} · ` : ''}{remaining > 0 ? `renews ${fmtDate(sub!.end_date)}` : 'expired'}</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="sect-t">Payment methods</div>
      <div className="group">
        {(cards ?? []).length > 0 ? (cards ?? []).map((c) => (
          <div className="method" key={c.id}>
            <span className={`brandmark ${(c.brand ?? '').toLowerCase().includes('master') ? 'mc' : 'visa'}`}>{(c.brand ?? 'CARD').slice(0, 4).toUpperCase()}</span>
            <div className="m"><strong>•••• •••• •••• {c.last4 ?? '????'}</strong><small>Expires {c.exp_month ?? '--'}/{c.exp_year ?? '--'}{c.is_default ? ' · default' : ''}</small></div>
            {c.is_default && <span className="gf-badge gf-badge-brand">Default</span>}
          </div>
        )) : (
          <div className="row" style={{ padding: '14px 0' }}>
            <span className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><CreditCard strokeWidth={1.9} /></span>
            <div className="m"><strong>No saved cards</strong><small>A card is saved automatically the first time you pay with Paystack</small></div>
          </div>
        )}
      </div>

      <div className="sect-t">Transactions</div>
      <div className="group">
        {txns.length > 0 ? txns.map((p) => {
          const refund = p.payment_status === 'refunded';
          return (
            <Link key={p.id} href={`/dashboard/wallet/${p.id}`} className="txn" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className={`tic ${refund ? 'in' : 'out'}`}>{refund ? <ArrowDownLeft strokeWidth={1.9} /> : <CreditCard strokeWidth={1.9} />}</span>
              <div className="m"><strong>Membership payment</strong><small>{fmtDate(eff(p))} · {p.payment_method ?? 'Paystack'}</small></div>
              <span className={`amt${refund ? ' credit' : ''}`}>{refund ? '+' : '−'}{fmtNaira(Number(p.amount ?? 0)).replace('−', '')}<small>{STATUS_LABEL[p.payment_status ?? ''] ?? p.payment_status}</small></span>
            </Link>
          );
        }) : (
          <div className="row" style={{ padding: '18px 0' }}>
            <span className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><Receipt strokeWidth={1.9} /></span>
            <div className="m"><strong>No payments yet</strong><small>Renewals show here</small></div>
          </div>
        )}
      </div>
    </section>
  );
}
