import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { paystackSecretKey } from '@/lib/paystack';

export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get('x-paystack-signature');
  if (!sig) return new NextResponse('Missing signature', { status: 400 });

  const expected = crypto
    .createHmac('sha512', paystackSecretKey())
    .update(raw)
    .digest('hex');

  if (sig !== expected) return new NextResponse('Bad signature', { status: 401 });

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  // Acknowledge the webhook fast and record it for offline reconciliation.
  // Verify endpoint is still the source of truth for end-of-flow updates.
  if (event.event === 'charge.success') {
    const supabase = await createServerClient();
    const data = event.data ?? {};
    const reference = String((data as { reference?: string }).reference ?? '');
    if (reference) {
      await supabase
        .from('payments')
        .update({ payment_status: 'successful' })
        .eq('paystack_reference', reference);
    }
  }

  return NextResponse.json({ received: true });
}
