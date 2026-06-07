import Link from 'next/link';
import { ArrowLeft, Share2, Check, Download } from 'lucide-react';

export const metadata = { title: 'Receipt' };

// Static receipt data keyed by the txn id used on the wallet page.
const RECEIPTS: Record<string, { amt: string; label: string; rows: [string, string][] }> = {
  '9f3a21': {
    amt: '₦37,999', label: 'Quarterly renewal',
    rows: [['Status', 'Successful'], ['Date', '12 Dec 2025, 09:14'], ['Method', 'Visa •••• 4242'], ['Reference', 'PSK-9F3A21'], ['Plan', 'Quarterly'], ['Gym', 'Powerhouse Fitness']],
  },
  '7c1b08': {
    amt: '₦2,500', label: 'Guest day pass',
    rows: [['Status', 'Successful'], ['Date', '28 Nov 2025, 17:42'], ['Method', 'GymFlow wallet'], ['Reference', 'PSK-7C1B08'], ['Gym', 'Powerhouse Fitness']],
  },
  '5a9d44': {
    amt: '₦5,000', label: 'Wallet top-up',
    rows: [['Status', 'Successful'], ['Date', '20 Nov 2025, 11:03'], ['Method', 'Visa •••• 4242'], ['Reference', 'PSK-5A9D44']],
  },
  ref3120: {
    amt: '₦5,000', label: 'Referral reward',
    rows: [['Status', 'Credited'], ['Date', '10 Nov 2025, 08:30'], ['Method', 'GymFlow credit'], ['Reference', 'GF-REF-3120']],
  },
};

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = RECEIPTS[id] ?? RECEIPTS['9f3a21'];

  return (
    <section className="view on" data-v="receipt">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet">
          <ArrowLeft strokeWidth={1.9} />
        </Link>
        <strong className="htitle">Receipt</strong>
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Share receipt"><Share2 strokeWidth={1.9} /></button>
      </div>

      <div className="receipt">
        <div className="rtop">
          <div className="ring"><Check strokeWidth={2.4} /></div>
          <div className="ra">{r.amt}</div>
          <div className="rl">{r.label}</div>
        </div>
        <div className="group">
          <div className="rlist">
            {r.rows.map(([k, v]) => (
              <div className="rrow" key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        </div>
        <button className="gf-btn gf-btn-secondary gf-btn-full"><Download strokeWidth={1.9} style={{ width: 16, height: 16 }} /> Download PDF</button>
      </div>
    </section>
  );
}
