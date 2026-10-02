import { NextResponse, type NextRequest } from 'next/server';
import { verifyPaystackSignature, webhookBodyHash } from '@/lib/webhook-verify';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  claimPaystackEvents,
  enqueuePaystackEvent,
  processClaimedPaystackEvent,
} from '@/lib/webhook-recovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Json = Record<string, unknown>;

/** A verified event is durably queued before fulfillment starts. */
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';
  if (!verifyPaystackSignature(raw, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let event: Json;
  try {
    event = JSON.parse(raw) as Json;
  } catch {
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'recovery queue unavailable' }, { status: 503 });
  }

  const hash = webhookBodyHash(raw);
  const queued = await enqueuePaystackEvent(admin, { bodyHash: hash, event, source: 'webhook' });
  if (!queued.ok) return NextResponse.json({ error: 'recovery queue unavailable' }, { status: 503 });
  if (queued.status === 'completed') return NextResponse.json({ received: true, replay: true });
  if (queued.status === 'dead') return NextResponse.json({ error: 'event requires operator repair' }, { status: 422 });

  try {
    const claimed = await claimPaystackEvents(admin, 1, hash);
    const job = claimed.jobs[0];
    if (!job) return NextResponse.json({ received: true, queued: true }, { status: 202 });
    const result = await processClaimedPaystackEvent(admin, job);
    if (result.status === 200) return NextResponse.json({ received: true });
    return NextResponse.json({
      error: result.outcome === 'permanent_failure' ? 'event requires operator repair' : 'fulfillment retry queued',
      queued: result.outcome === 'retry',
    }, { status: result.status });
  } catch {
    // The durable row stays leased and becomes claimable after ten minutes.
    return NextResponse.json({ error: 'fulfillment retry queued' }, { status: 500 });
  }
}
