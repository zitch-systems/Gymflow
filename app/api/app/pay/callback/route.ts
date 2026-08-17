import { verifyTransaction } from '@/lib/paystack';
import { fulfillCharge } from '@/lib/paystack-fulfill';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Where Paystack sends a member back after a checkout started by the Android
// app (/api/app/renew). The web callback page can't take this traffic: it is a
// cookie-authenticated Server Component, and the browser tab Paystack redirects
// into carries none of the app's session.
//
// So this route is public, and deliberately so. It can't be used to invent a
// payment: the only thing an unauthenticated caller can do is name a reference,
// which is then verified against Paystack with our secret key, and fulfilled
// from the metadata Paystack echoes back — metadata we set at initialization.
// Fulfilment is idempotent and credits the member named in that metadata, never
// the caller. In other words the worst a stranger can do here is finish a real
// payment that the webhook was going to finish anyway.

// The app's deep-link scheme (mobile/app.json → expo.scheme). Kept in sync by
// hand; a mismatch strands the member on the page below with a working "Return
// to the app" button, rather than losing the payment.
const APP_SCHEME = 'gymflow';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// A tiny page that hands control back to the app. A 302 straight to a custom
// scheme is dropped by some Android browsers, so the redirect is scripted, with
// a visible button behind it for the cases where even that is blocked.
function handOff(status: 'success' | 'failed', reference: string, message: string): Response {
  const deepLink = `${APP_SCHEME}://pay/callback?status=${status}&reference=${encodeURIComponent(reference)}`;
  const ok = status === 'success';
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ok ? 'Payment successful' : 'Payment not completed'}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0a0a12; color:#f3f3fa; font:400 16px/1.6 system-ui, -apple-system, sans-serif; padding:24px; }
  .card { max-width:360px; text-align:center; }
  .ring { width:72px; height:72px; margin:0 auto 20px; border-radius:50%; display:flex; align-items:center;
          justify-content:center; font-size:34px; background:${ok ? 'rgba(17,209,139,0.12)' : 'rgba(255,69,96,0.12)'};
          color:${ok ? '#11d18b' : '#ff4560'}; }
  h1 { font-size:1.25rem; margin:0 0 8px; }
  p { color:#9b9bb8; margin:0 0 24px; font-size:0.94rem; }
  a.btn { display:block; padding:14px; border-radius:12px; background:#11d18b; color:#04150e;
          font-weight:700; text-decoration:none; }
</style></head>
<body><div class="card">
  <div class="ring">${ok ? '&#10003;' : '&#10005;'}</div>
  <h1>${ok ? 'Payment successful' : 'Payment not completed'}</h1>
  <p>${escapeHtml(message)}</p>
  <a class="btn" href="${escapeHtml(deepLink)}">Return to the app</a>
</div>
<script>location.replace(${JSON.stringify(deepLink)});</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const reference = (url.searchParams.get('reference') ?? url.searchParams.get('trxref') ?? '').trim();
  if (!reference) return handOff('failed', '', 'No payment reference was returned. If you were charged, it’ll reflect shortly.');

  // Each call costs a Paystack verify round-trip, so cap how fast one caller can
  // spend them. Fails open (lib/rate-limit.ts) — a limiter outage must never
  // strand a member who has just paid.
  const ip = await clientIp();
  if (!(await rateLimit(`app-pay-callback:ip:${ip}`, 60, 300))) {
    return handOff('failed', reference, 'Too many attempts. Open the app in a moment — your payment will reflect once it settles.');
  }

  try {
    const v = await verifyTransaction(reference);
    if (!v.ok) return handOff('failed', reference, v.error);
    if (v.status !== 'success') return handOff('failed', reference, `Payment status: ${v.status}. No charge was completed.`);

    // Confirmed at Paystack — fulfil it from the Paystack-verified metadata, the
    // same authoritative, idempotent path the webhook uses. The webhook remains
    // the backup if this ever fails.
    const f = await fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, channel: v.channel, metadata: v.metadata });
    if (!f.ok) {
      console.error(`[app/pay/callback] fulfill failed for ${v.reference}: ${f.error}`);
      return handOff('success', v.reference, 'Your payment went through. Your membership will update shortly.');
    }
    return handOff('success', v.reference, 'Your membership has been extended. Back to training.');
  } catch (e) {
    console.error(`[app/pay/callback] ${reference}: ${(e as Error).message}`);
    return handOff('failed', reference, 'We couldn’t confirm this payment. If you were charged, it’ll reflect shortly.');
  }
}
