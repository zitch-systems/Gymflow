import Link from 'next/link';
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { verifyTransaction } from '@/lib/paystack';
import { fulfillPlatformSubscription } from '@/lib/paystack-fulfill';

export const metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Paystack redirects here after a GymFlow subscription checkout. We verify the
// transaction and activate the subscription (idempotent); the webhook is the
// authoritative backup.
export default async function BillingCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let ok = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly.';
  if (reference) {
    const v = await verifyTransaction(reference);
    if (v.ok && v.status === 'success') {
      const f = await fulfillPlatformSubscription({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata });
      if (!f.ok) console.error(`[billing/callback] fulfill failed for ${v.reference}: ${f.error}`);
      ok = true;
      msg = 'Your GymFlow subscription is active. Thank you!';
    } else if (v.ok) {
      msg = `Payment status: ${v.status}. No charge was completed.`;
    } else {
      msg = v.error;
    }
  }

  return (
    <>
      <div className="page-h"><div><h1>{ok ? 'Subscription active' : 'Payment not completed'}</h1><p>GymFlow billing</p></div></div>
      <div className="panel" style={{ maxWidth: 560, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 28 }}>
        <span className="gf-kpi-icon" style={{ width: 56, height: 56, background: ok ? 'var(--gf-success-soft)' : 'var(--gf-danger-soft)', color: ok ? 'var(--gf-success)' : 'var(--gf-danger)' }}>
          {ok ? <CheckCircle2 strokeWidth={1.7} /> : <XCircle strokeWidth={1.7} />}
        </span>
        <h2 style={{ margin: 0 }}>{ok ? 'Payment successful' : 'Payment not completed'}</h2>
        <p style={{ color: 'var(--gf-text-secondary)', margin: 0 }}>{msg}</p>
        <Link href="/admin/billing" className="gf-btn gf-btn-primary" style={{ textDecoration: 'none', marginTop: 6 }}>
          Back to billing <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </Link>
      </div>
    </>
  );
}
