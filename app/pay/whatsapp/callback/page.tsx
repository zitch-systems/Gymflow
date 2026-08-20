import { CheckCircle2, Clock, XCircle, ArrowRight } from 'lucide-react';
import { verifyTransaction } from '@/lib/paystack';
import { fulfillCharge } from '@/lib/paystack-fulfill';

export const metadata = { title: 'Payment' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WA_NUMBER = (process.env.WHATSAPP_BUSINESS_NUMBER ?? '2349169582776').replace(/\D/g, '');

// Paystack redirects here after a checkout started from WhatsApp. Unlike
// /dashboard/renew/callback, this page must NOT require a signed-in web
// session: a member who tapped a checkout link inside WhatsApp has no browser
// session on this device at all — requireMember() would just bounce them to
// /login, which is what a member paying from WhatsApp was landing on instead
// of ever getting back to the chat. fulfillCharge is the same idempotent,
// session-free path the charge.success webhook uses, so this page can record
// the payment itself without waiting on (or duplicating) that webhook.
//
// THREE OUTCOMES, NOT TWO. A confirmed charge whose fulfilment did not go
// through is its own state: the money has left the member's account, so the
// page may not say the charge failed — but no day was added either, so it may
// not say the membership is updated. fulfillCharge refuses for reasons a member
// can genuinely land in (they are no longer actively linked to the gym the
// checkout was for, the plan moved tenant) and the reference is the only thing
// that lets the gym find the payment afterwards, so the honest middle state
// shows it.
type Outcome = 'paid' | 'pending' | 'failed';

export default async function WhatsAppPayCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let outcome: Outcome = 'failed';
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly — check WhatsApp for a confirmation.';
  if (reference) {
    const v = await verifyTransaction(reference);
    if (v.ok && v.status === 'success') {
      const f = await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata, split: v.split });
      if (!f.ok) console.error(`[whatsapp/pay-callback] fulfill failed for ${v.reference}: ${f.error}`);
      outcome = f.ok ? 'paid' : 'pending';
      msg = f.ok
        ? 'Your membership is updated. Head back to WhatsApp — I’ll confirm it there too.'
        : `We’ve received your payment, but it hasn’t been applied to your membership yet. Head back to WhatsApp — I’ll confirm there as soon as it lands. If it doesn’t show up shortly, contact your gym and quote this reference: ${v.reference}`;
    } else if (v.ok) {
      msg = `Payment status: ${v.status}. No charge was completed.`;
    } else {
      msg = v.error;
    }
  }

  const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('menu')}`;

  return (
    <section className="view on" data-v="whatsapp-pay-callback">
      {/* Best-effort auto-return; the button below is the reliable path on
          browsers (mostly in-app WebViews) that block a scripted redirect. */}
      <meta httpEquiv="refresh" content={`2;url=${waUrl}`} />
      <div className="pay-result">
        <div className={`pay-ic ${outcome === 'failed' ? 'bad' : 'ok'}`}>
          {outcome === 'paid' ? <CheckCircle2 strokeWidth={1.7} />
            : outcome === 'pending' ? <Clock strokeWidth={1.7} />
              : <XCircle strokeWidth={1.7} />}
        </div>
        <h2>{outcome === 'paid' ? 'Payment successful' : outcome === 'pending' ? 'Payment received' : 'Payment not completed'}</h2>
        <p>{msg}</p>
        <a href={waUrl} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ textDecoration: 'none', marginTop: 6 }}>
          Return to WhatsApp <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </a>
      </div>
    </section>
  );
}
