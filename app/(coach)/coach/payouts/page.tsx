import { Banknote, ArrowRight } from 'lucide-react';
export const metadata = { title: 'Payouts · Instructor' };
const HISTORY = [
  { date: '26 May', sub: '3 classes + 2 PT', amt: '₦52,000', st: ['gf-badge-success', 'Paid'] },
  { date: '19 May', sub: '4 classes + 1 PT', amt: '₦48,000', st: ['gf-badge-success', 'Paid'] },
  { date: '12 May', sub: '3 classes', amt: '₦36,000', st: ['gf-badge-success', 'Paid'] },
  { date: '5 May', sub: '4 classes + 3 PT', amt: '₦64,000', st: ['gf-badge-success', 'Paid'] },
];
export default function CoachPayouts() {
  return (
    <>
      <div className="hdr"><h1>Payouts</h1><p>Weekly payouts via Paystack · next on 2 Jun</p></div>
      <div className="wtop">
        <div className="balance">
          <small>Pending payout</small>
          <div className="amt">₦42,000</div>
          <div style={{ fontSize: '0.84rem', opacity: 0.92 }}>From 3 classes + 1 PT this week</div>
          <div className="acts"><button className="gf-btn"><Banknote strokeWidth={1.9} size={16} /> Request early</button></div>
        </div>
        <div className="bankcard">
          <span className="lbl">Payout account</span>
          <span className="num">GTBank •••• 8842</span>
          <span style={{ color: 'var(--gf-text-muted)', fontSize: '0.82rem' }}>Coach Femi Adewale</span>
          <span className="link" style={{ marginTop: 6 }}>Change account <ArrowRight strokeWidth={2} size={14} /></span>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h"><div><h3>Payout history</h3><div className="sub">Last 6 payouts</div></div></div>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Sessions</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {HISTORY.map((h) => (
              <tr key={h.date}><td>{h.date}</td><td style={{ color: 'var(--gf-text-secondary)' }}>{h.sub}</td><td><span className={`gf-badge ${h.st[0]}`}>{h.st[1]}</span></td><td className="naira" style={{ textAlign: 'right' }}>{h.amt}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
