import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
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
export default async function WhatsAppPayCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let ok = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly — check WhatsApp for a confirmation.';
  if (reference) {
    const v = await verifyTransaction(reference);
    if (v.ok && v.status === 'success') {
      const f = await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata, split: v.split });
      if (!f.ok) console.error(`[whatsapp/pay-callback] fulfill failed for ${v.reference}: ${f.error}`);
      ok = true;
      msg = 'Your membership is updated. Head back to WhatsApp — I’ll confirm it there too.';
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
        <div className={`pay-ic ${ok ? 'ok' : 'bad'}`}>{ok ? <CheckCircle2 strokeWidth={1.7} /> : <XCircle strokeWidth={1.7} />}</div>
        <h2>{ok ? 'Payment successful' : 'Payment not completed'}</h2>
        <p>{msg}</p>
        <a href={waUrl} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ textDecoration: 'none', marginTop: 6 }}>
          Return to WhatsApp <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </a>
      </div>
    </section>
  );
}
