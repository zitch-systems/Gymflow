import Link from 'next/link';
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { verifyTransaction } from '@/lib/paystack';
import { fulfillCharge } from '@/lib/paystack-fulfill';

export const metadata = { title: 'Payment' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Paystack redirects here after checkout. We verify the transaction server-side
// and record it (idempotent) so the renewal lands even if the webhook isn't
// configured; the webhook remains the authoritative backup.
export default async function RenewCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  await requireMember();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let ok = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly.';
  if (reference) {
    const v = await verifyTransaction(reference);
    if (v.ok && v.status === 'success') {
      await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata });
      ok = true;
      msg = 'Your membership has been renewed. Thank you!';
    } else if (v.ok) {
      msg = `Payment status: ${v.status}. No charge was completed.`;
    } else {
      msg = v.error;
    }
  }

  return (
    <section className="view on" data-v="renew-callback">
      <div className="pay-result">
        <div className={`pay-ic ${ok ? 'ok' : 'bad'}`}>{ok ? <CheckCircle2 strokeWidth={1.7} /> : <XCircle strokeWidth={1.7} />}</div>
        <h2>{ok ? 'Payment successful' : 'Payment not completed'}</h2>
        <p>{msg}</p>
        <Link href="/dashboard" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ textDecoration: 'none', marginTop: 6 }}>
          Go to dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </Link>
        {!ok && <Link href="/dashboard/renew" className="gf-btn gf-btn-secondary gf-btn-full" style={{ textDecoration: 'none', marginTop: 10 }}>Try again</Link>}
      </div>
    </section>
  );
}
