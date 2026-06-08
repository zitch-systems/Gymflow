import { createHmac } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { fulfillCharge } from '@/lib/paystack-fulfill';

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
  await fulfillCharge({
    reference: d.reference,
    amountKobo: Number(d.amount ?? 0),
    channel: d.channel ?? null,
    metadata: d.metadata ?? {},
  });
  return NextResponse.json({ received: true });
}
