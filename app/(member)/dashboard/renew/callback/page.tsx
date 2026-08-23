import Link from 'next/link';
import { redirect } from 'next/navigation';
import { XCircle, ArrowRight } from 'lucide-react';
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

  // This page only ever renders a NON-success outcome: a fulfilled renewal
  // redirects to /dashboard below and never reaches the markup. It used to set
  // an `ok` flag on the fulfilment-failed path, which rendered a green tick and
  // "Payment successful" over a membership that had not moved.
  //
  // `charged` separates the two remaining outcomes: money taken but not yet
  // applied, versus no charge at all. Telling someone who WAS charged that
  // their payment "was not completed" sends them to pay a second time.
  let charged = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly.';
  if (reference) {
    const v = await verifyTransaction(reference);
    if (v.ok && v.status === 'success') {
      // The charge is confirmed at Paystack. Fulfill it from the Paystack-
      // verified metadata (member/gym/plan) — the same authoritative, idempotent
      // path the webhook uses. We deliberately do NOT gate on the signed-in user
      // matching metadata.member_id: fulfillCharge always credits the member
      // named in the (server-set) metadata, so a session/account mismatch at the
      // callback (e.g. cross-domain redirect back from Paystack) can neither
      // hijack a payment nor lose one — it just gets recorded to whoever paid.
      // The previous strict check rejected legitimate renewals with "belongs to
      // a different account" when the callback's session differed from checkout.
      if (v.metadata?.member_id && v.metadata.member_id !== user.id) {
        console.warn(`[renew/callback] viewer ${user.id} != payer ${String(v.metadata.member_id)} for ${v.reference}; fulfilling per metadata`);
      }
      const f = await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata, split: v.split });
      if (!f.ok) console.error(`[renew/callback] fulfill failed for ${v.reference}: ${f.error}`);
      // Success belongs in the member's own portal, not on a standalone page
      // that reads like part of the payment processor. The dashboard raises a
      // confirmation modal from this reference, showing the amount, plan and
      // the new expiry date the renewal just bought.
      //
      // Only on a fulfilled charge: if fulfilment failed, fall through to the
      // page below, which explains what to do rather than congratulating
      // someone whose membership did not move.
      if (f.ok) redirect(`/dashboard?paid=${encodeURIComponent(v.reference)}`);
      // Falling through here means the charge succeeded but fulfilment did
      // not. `ok` must stay false — it drives the green tick and the
      // "Payment successful" heading, and this membership has NOT moved.
      // The webhook is the authoritative backup and usually lands within a
      // minute, so say that plainly and hand over the reference to quote.
      charged = true;
      msg = `Your payment went through, but we couldn’t apply it to your membership yet. It usually lands within a minute. If it hasn’t, quote reference ${v.reference}.`;
    } else if (v.ok) {
      msg = `Payment status: ${v.status}. No charge was completed.`;
    } else {
      msg = v.error;
    }
  }

  return (
    <section className="view on" data-v="renew-callback">
      <div className="pay-result">
        <div className="pay-ic bad"><XCircle strokeWidth={1.7} /></div>
        <h2>{charged ? 'Payment received — not applied yet' : 'Payment not completed'}</h2>
        <p>{msg}</p>
        <p style={{ fontSize: '0.84rem', color: 'var(--gf-text-muted)', margin: '4px 0 0' }}>
          Charged but not renewed? It usually lands within a minute — otherwise email <a href="mailto:hello@gymflow.ng" style={{ color: 'var(--gf-brand)' }}>hello@gymflow.ng</a> with your payment reference.
        </p>
        <Link href="/dashboard" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ textDecoration: 'none', marginTop: 6 }}>
          Go to dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </Link>
        {/* No "Try again" once the charge succeeded — the money is already
            taken, and re-running checkout would double-charge. */}
        {!charged && <Link href="/dashboard/renew" className="gf-btn gf-btn-secondary gf-btn-full" style={{ textDecoration: 'none', marginTop: 10 }}>Try again</Link>}
      </div>
    </section>
  );
}
