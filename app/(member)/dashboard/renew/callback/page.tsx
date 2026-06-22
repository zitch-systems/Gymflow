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
  const { user } = await requireMember();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let ok = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly.';
  if (reference) {
    const v = await verifyTransaction(reference);
    // Bind the reference to the signed-in member: only fulfill a transaction
    // whose Paystack-verified metadata names this user. Without this, any member
    // could submit another member's reference into their own callback. (Impact is
    // bounded — fulfillCharge derives member/gym from the metadata and is
    // idempotent — but the reference should still belong to the caller.)
    if (v.ok && v.status === 'success' && v.metadata?.member_id && v.metadata.member_id !== user.id) {
      msg = 'This payment reference belongs to a different account.';
    } else if (v.ok && v.status === 'success') {
      // The charge is confirmed at Paystack, so show success. Recording it is
      // idempotent and the webhook is the authoritative backup; if this inline
      // attempt fails we log it (the webhook retry will still land it) rather
      // than alarming a member who genuinely paid.
      const f = await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata });
      if (!f.ok) console.error(`[renew/callback] fulfill failed for ${v.reference}: ${f.error}`);
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
        {!ok && (
          <p style={{ fontSize: '0.84rem', color: 'var(--gf-text-muted)', margin: '4px 0 0' }}>
            Charged but not renewed? It usually lands within a minute — otherwise email <a href="mailto:hello@gymflow.ng" style={{ color: 'var(--gf-brand)' }}>hello@gymflow.ng</a> with your payment reference.
          </p>
        )}
        <Link href="/dashboard" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ textDecoration: 'none', marginTop: 6 }}>
          Go to dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </Link>
        {!ok && <Link href="/dashboard/renew" className="gf-btn gf-btn-secondary gf-btn-full" style={{ textDecoration: 'none', marginTop: 10 }}>Try again</Link>}
      </div>
    </section>
  );
}
