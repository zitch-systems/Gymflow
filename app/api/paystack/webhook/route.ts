import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { fulfillCharge } from '@/lib/paystack-fulfill';
import { isPlatformEvent, handlePlatformEvent } from '@/lib/platform-fulfill';
import { handleRefundEvent, isRefundEvent } from '@/lib/paystack-refund';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Paystack webhook. Verifies the x-paystack-signature (HMAC-SHA512 of the raw
// body with the secret key), then routes the event:
//   • PLATFORM (gym → GymFlow) subscription events → lib/platform-fulfill
//   • MEMBER (member → gym) one-off charges → lib/paystack-fulfill
// Both fulfillment paths are idempotent and use the service-role client.
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';
  const expected = createHmac('sha512', secret).update(raw).digest('hex');
  // Constant-time compare to avoid leaking the signature byte-by-byte via timing.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(raw);

  // Refunds & lost disputes → flip the corresponding payment row's status to
  // 'refunded' (either member or platform table) and audit-log. Handled BEFORE
  // isPlatformEvent so a member refund isn't misclassified.
  if (isRefundEvent(event)) {
    const result = await handleRefundEvent(event);
    if (!result.ok) {
      console.error(`[paystack/webhook] refund ${event?.event} failed: ${result.error}`);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Platform SaaS billing (subscriptions, recurring charges, dunning).
  if (isPlatformEvent(event)) {
    const result = await handlePlatformEvent(event);
    if (!result.ok) {
      console.error(`[paystack/webhook] platform ${event?.event} failed: ${result.error}`);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Member → gym membership charges.
  if (event?.event !== 'charge.success') return NextResponse.json({ received: true });

  const d = event.data ?? {};
  const result = await fulfillCharge({
    reference: d.reference,
    amountKobo: Number(d.amount ?? 0),
    channel: d.channel ?? null,
    metadata: d.metadata ?? {},
  });

  if (!result.ok) {
    console.error(`[paystack/webhook] fulfill failed for ${d.reference}: ${result.error}`);
    // Transient failures (DB/config) → 500 so Paystack retries and the charge
    // isn't silently lost. Permanent ones (unusable metadata) won't improve on
    // retry, so ack to stop the resends.
    if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
