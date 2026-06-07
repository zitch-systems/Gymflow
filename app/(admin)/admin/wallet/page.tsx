import { Banknote, Building2, ArrowDownLeft, ArrowUpRight, CreditCard } from 'lucide-react';

export const metadata = { title: 'Wallet' };

const TXNS = [
  { icon: CreditCard, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'Subscription · Tunde A.', sub: 'Annual renewal', type: 'Inflow', date: 'Today', st: ['gf-badge-success', 'Settled'], amt: '+₦119,999', dir: 'in' as const },
  { icon: Banknote, fg: 'var(--gf-info)', bg: 'var(--gf-info-soft)', title: 'Payout to GTBank', sub: '•••• 8842', type: 'Withdrawal', date: 'Yesterday', st: ['gf-badge-info', 'Processing'], amt: '−₦800,000', dir: 'out' as const },
  { icon: CreditCard, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'Subscription · Grace U.', sub: 'Annual renewal', type: 'Inflow', date: '28 May', st: ['gf-badge-success', 'Settled'], amt: '+₦119,999', dir: 'in' as const },
  { icon: CreditCard, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'Subscription · Kelechi O.', sub: 'Quarterly renewal', type: 'Inflow', date: '27 May', st: ['gf-badge-success', 'Settled'], amt: '+₦37,999', dir: 'in' as const },
];

export default function AdminWallet() {
  return (
    <>
      <div className="page-h"><div><h1>Wallet</h1><p>Powerhouse Fitness · settlements via Paystack</p></div></div>

      <div className="wtop">
        <div className="balance">
          <small>Available balance</small>
          <div className="amt">₦1,284,500</div>
          <div className="sub">₦184,000 pending settlement · next payout 2 Jun</div>
          <div className="acts">
            <button className="gf-btn solid"><Banknote strokeWidth={1.9} size={16} /> Withdraw</button>
            <button className="gf-btn"><Building2 strokeWidth={1.9} size={16} /> Bank account</button>
          </div>
        </div>
        <div className="wstats">
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><ArrowDownLeft strokeWidth={1.9} /></div><div><div className="v">₦5.8M</div><div className="l">Collected this month</div></div></div>
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><ArrowUpRight strokeWidth={1.9} /></div><div><div className="v">₦4.2M</div><div className="l">Withdrawn this month</div></div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <div><h3>Transactions</h3><div className="sub">All settlements &amp; payments</div></div>
          <div style={{ display: 'flex', gap: 8 }}><span className="gf-chip active">All</span><span className="gf-chip">In</span><span className="gf-chip">Out</span></div>
        </div>
        <table className="tbl">
          <thead><tr><th>Description</th><th>Type</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {TXNS.map((t, i) => {
              const Icon = t.icon;
              return (
                <tr key={i}>
                  <td><div className="who"><span className="gf-avatar gf-avatar-sm" style={{ background: t.bg, color: t.fg, border: 'none' }}><Icon strokeWidth={1.9} size={15} /></span><div><strong>{t.title}</strong><small>{t.sub}</small></div></div></td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{t.type}</td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{t.date}</td>
                  <td><span className={`gf-badge ${t.st[0]}`}><span className="gf-dot" />{t.st[1]}</span></td>
                  <td className={`naira tx-amt ${t.dir}`} style={{ textAlign: 'right' }}>{t.amt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
