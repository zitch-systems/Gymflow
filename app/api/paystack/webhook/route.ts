import { createHmac } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { fulfillCharge, fulfillPlatformSubscription } from '@/lib/paystack-fulfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Paystack webhook. Verifies the x-paystack-signature (HMAC-SHA512 of the raw
// body with the secret key), then on charge.success records the payment and
// extends the member's subscription (idempotent, via the shared fulfill helper
// which uses the service-role client).
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';
  const expected = createHmac('sha512', secret).update(raw).digest('hex');
  if (signature !== expected) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });

  const event = JSON.parse(raw);
  if (event?.event !== 'charge.success') return NextResponse.json({ received: true });

  const d = event.data ?? {};
  const charge = {
    reference: d.reference,
    amountKobo: Number(d.amount ?? 0),
    channel: d.channel ?? null,
    metadata: d.metadata ?? {},
  };
  // Route by intent: gym→GymFlow subscriptions vs member→gym membership dues.
  const result = charge.metadata?.kind === 'platform_subscription'
    ? await fulfillPlatformSubscription(charge)
    : await fulfillCharge(charge);

  if (!result.ok) {
    console.error(`[paystack/webhook] fulfill failed for ${d.reference}: ${result.error}`);
    // Transient failures (DB/config) → 500 so Paystack retries and the charge
    // isn't silently lost. Permanent ones (unusable metadata) won't improve on
    // retry, so ack to stop the resends.
    if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
