import Link from 'next/link';
import {
  Bell, Wallet, Repeat, Plus, CreditCard, ChevronRight, UserPlus, ArrowDownLeft, Gift,
} from 'lucide-react';

export const metadata = { title: 'Wallet' };

const SPEND = [
  { m: 'Jul', h: 34 }, { m: 'Aug', h: 58 }, { m: 'Sep', h: 30 },
  { m: 'Oct', h: 72 }, { m: 'Nov', h: 44 }, { m: 'Dec', h: 90, now: true },
];

const TXNS = [
  { id: '9f3a21', title: 'Quarterly renewal', sub: '12 Dec · Visa 4242', amt: '−₦37,999', dir: 'out' as const, icon: CreditCard },
  { id: '7c1b08', title: 'Guest day pass', sub: '28 Nov · Wallet', amt: '−₦2,500', dir: 'out' as const, icon: UserPlus },
  { id: '5a9d44', title: 'Wallet top-up', sub: '20 Nov · Visa 4242', amt: '+₦5,000', dir: 'in' as const, icon: ArrowDownLeft },
  { id: 'ref3120', title: 'Referral reward', sub: '10 Nov · GymFlow', amt: '+₦5,000', dir: 'in' as const, icon: Gift },
];

// Wallet — recreates revamp/member.html "wallet": balance card, 6-month spend
// bars, auto-debit toggle, renew row, payment methods, transactions. Static data.
export default function WalletPage() {
  return (
    <section className="view on" data-v="wallet">
      <div className="mhead" style={{ paddingBottom: 10 }}>
        <strong className="htitle">Wallet</strong>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} /><span className="nub">3</span>
        </Link>
      </div>

      <div className="wcard">
        <div className="wlabel"><Wallet strokeWidth={1.9} /> GymFlow wallet</div>
        <div className="wbal">₦4,500<span className="k"> .00</span></div>
        <div className="wnext"><Repeat strokeWidth={1.9} /> Next auto-debit 12 Mar · ₦37,999</div>
        <div className="wbtns">
          <button className="b-primary"><Plus strokeWidth={2} /> Top up</button>
          <Link href="/dashboard/renew" className="b-ghost" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none', borderRadius: 'var(--gf-radius-sm)', padding: 11, fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.84rem' }}><CreditCard strokeWidth={2} /> Renew plan</Link>
        </div>
      </div>

      <div className="spend">
        <div className="sh"><div><b>₦42,000</b> <small>spent this month</small></div><small>Last 6 months</small></div>
        <div className="bars">
          {SPEND.map((s) => (
            <div key={s.m} className={`bcol${s.now ? ' now' : ''}`}>
              <div className="bv" style={{ height: `${s.h}%` }} /><span>{s.m}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sect-t">Membership</div>
      <div className="toggle-row">
        <span className="ic"><Repeat strokeWidth={1.9} /></span>
        <div className="m"><strong>Auto-debit</strong><small>Renew automatically on 12 Mar</small></div>
        <span className="switch on" aria-label="Auto-debit on" role="switch" aria-checked="true" />
      </div>
      <div className="group" style={{ marginBottom: 14 }}>
        <Link href="/dashboard/renew" className="row">
          <span className="ic"><CreditCard strokeWidth={1.9} /></span>
          <div className="m"><strong>Renew or change plan</strong><small>Annual · renews 12 Mar 2027</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="sect-t">Payment methods <a>Add</a></div>
      <div className="group">
        <div className="method"><span className="brandmark visa">VISA</span><div className="m"><strong>•••• •••• •••• 4242</strong><small>Expires 08/27 · default</small></div><span className="gf-badge gf-badge-brand">Default</span></div>
        <div className="method"><span className="brandmark mc">MC</span><div className="m"><strong>•••• •••• •••• 8821</strong><small>Expires 03/26</small></div></div>
        <div className="row" style={{ padding: '14px 0' }}>
          <span className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><Plus strokeWidth={1.9} /></span>
          <div className="m"><strong>Add payment method</strong><small>Card · bank · Paystack</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </div>
      </div>

      <div className="sect-t">Transactions <a>Export</a></div>
      <div className="group">
        {TXNS.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.id} href={`/dashboard/wallet/${t.id}`} className="txn" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className={`tic ${t.dir}`}><Icon strokeWidth={1.9} /></span>
              <div className="m"><strong>{t.title}</strong><small>{t.sub}</small></div>
              <span className={`amt${t.dir === 'in' ? ' credit' : ''}`}>{t.amt}<small>{t.dir === 'in' && t.id === 'ref3120' ? 'Credited' : 'Successful'}</small></span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
