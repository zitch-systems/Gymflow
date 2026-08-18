import { NextResponse, type NextRequest } from 'next/server';
import { fulfillCharge } from '@/lib/paystack-fulfill';
import { isPlatformEvent, handlePlatformEvent } from '@/lib/platform-fulfill';
import { handleRefundEvent, isRefundEvent } from '@/lib/paystack-refund';
import { isMemberSubEvent, handleMemberSubEvent } from '@/lib/member-sub-fulfill';
import { isTransferEvent, handleTransferEvent } from '@/lib/transfer-fulfill';
import { verifyPaystackSignature, webhookBodyHash } from '@/lib/webhook-verify';
import { createAdminClient } from '@/lib/supabase/admin';
import { confirmWhatsAppPayment } from '@/lib/whatsapp/notify';
import { readSplit } from '@/lib/paystack-split';
import { captureServerEvent } from '@/lib/server-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Json = Record<string, unknown>;

// Route the verified event to its fulfillment module. Extracted so the replay
// ledger can wrap the whole chain: only a 200 ("we're done with this body")
// records the hash; a 500 leaves no row so Paystack's retry reprocesses.
async function dispatch(event: Json): Promise<NextResponse> {
  // Refunds & lost disputes → flip the corresponding payment row's status to
  // 'refunded' (either member or platform table) and audit-log. Handled BEFORE
  // isPlatformEvent so a member refund isn't misclassified.
  if (isRefundEvent(event)) {
    const result = await handleRefundEvent(event);
    if (!result.ok) {
      logFailure('refund', event, result.error);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Instructor payout transfers (transfer.success/failed/reversed). Cheap
  // name check, no overlap with the charge/subscription flows.
  if (isTransferEvent(event)) {
    const result = await handleTransferEvent(event);
    if (!result.ok) {
      logFailure('transfer', event, result.error);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Member auto-recurring billing (member Paystack Subscriptions). Must run
  // BEFORE isPlatformEvent — both flows use subscription.* / invoice.* events
  // and the member check is authoritative (looks up subscription_code /
  // customer_code in member_subscriptions).
  if (await isMemberSubEvent(event)) {
    const result = await handleMemberSubEvent(event);
    if (!result.ok) {
      logFailure('member sub', event, result.error);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Platform SaaS billing (subscriptions, recurring charges, dunning).
  if (isPlatformEvent(event)) {
    const result = await handlePlatformEvent(event);
    if (!result.ok) {
      logFailure('platform', event, result.error);
      if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Member → gym membership charges.
  if (event?.event !== 'charge.success') return NextResponse.json({ received: true });

  const d = (event.data as Json) ?? {};
  const result = await fulfillCharge({
    reference: d.reference as string,
    amountKobo: Number(d.amount ?? 0),
    channel: (d.channel as string) ?? null,
    metadata: (d.metadata as Json) ?? {},
    // Paystack states the split it applied on the event itself (subaccount +
    // fees_split). It is the only record of what the platform actually kept on
    // this charge — nothing reconstructs it later, because the rate lives on a
    // mutable subaccount — so it is read here and stamped onto the payment row.
    split: readSplit(d),
  });

  if (!result.ok) {
    logFailure('fulfill', event, result.error);
    // Transient failures (DB/config) → 500 so Paystack retries and the charge
    // isn't silently lost. Permanent ones (unusable metadata) won't improve on
    // retry, so ack to stop the resends.
    if (!result.permanent) return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Confirm on WhatsApp. Gated on `created` so the webhook and the post-checkout
  // callback — which Paystack fires almost simultaneously for the same
  // transaction — cannot both message them. Awaited but never fatal: the money
  // is already settled and a failed courtesy message must not turn that into a
  // retry.
  //
  // member_id/gym_id come along so this reaches members who paid on the web or
  // in the app, not only those who started the checkout in WhatsApp. The
  // metadata is the same snapshot fulfillCharge just validated and used to
  // credit the subscription, so by this line it has already been checked
  // against the plan row and the member's active link to the gym.
  if (result.ok && result.created) {
    try {
      const admin = createAdminClient();
      const meta = ((d.metadata as Json) ?? {}) as Record<string, unknown>;
      await confirmWhatsAppPayment(admin, {
        reference: d.reference as string,
        amountKobo: Number(d.amount ?? 0),
        memberId: typeof meta.member_id === 'string' ? meta.member_id : null,
        gymId: typeof meta.gym_id === 'string' ? meta.gym_id : null,
      });
    } catch (e) {
      console.error('[paystack/webhook] whatsapp confirmation failed:', (e as Error).message);
    }
  }

  return NextResponse.json({ received: true });
}

// Fulfillment failures are money-path failures: console for Vercel logs plus a
// Sentry event (inert without SENTRY_DSN) so they page instead of scrolling by.
function logFailure(flow: string, event: Json, error?: string) {
  const name = typeof event?.event === 'string' ? event.event : 'unknown';
  console.error(`[paystack/webhook] ${flow} ${name} failed: ${error}`);
  void captureServerEvent(`paystack webhook ${flow} failed`, { event: name, error: error ?? null });
}

// Paystack webhook. Verifies the x-paystack-signature (HMAC-SHA512 of the raw
// body with the secret key), consults the replay ledger, then routes the event:
//   • PLATFORM (gym → GymFlow) subscription events → lib/platform-fulfill
//   • MEMBER (member → gym) one-off charges → lib/paystack-fulfill
// Both fulfillment paths are idempotent and use the service-role client.
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
    // Signed but not JSON — a retry re-sends the same bytes, so 4xx to stop the
    // loop rather than throw an unhandled 500 (matches the resend/auth webhooks).
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  // Replay ledger. Charge events are internally replay-safe (UNIQUE
  // paystack_reference), but status-flip events (subscription.disable etc.)
  // are not — a captured signed body replayed later would re-cancel a paying
  // account. A replay is byte-identical, so the body hash is the identity.
  // Fail-open: if the ledger is unreachable the event still processes (the
  // per-flow idempotency guards remain), matching the rate-limiter's posture.
  const hash = webhookBodyHash(raw);
  let ledger: ReturnType<typeof createAdminClient> | null = null;
  try {
    ledger = createAdminClient();
    // `as never`: webhook_events postdates the generated database.types.ts
    // (same pattern as payout_change_requests in lib/actions/gym.ts).
    const { data: seen } = await ledger.from('webhook_events' as never).select('body_hash').eq('body_hash', hash).maybeSingle();
    if (seen) return NextResponse.json({ received: true, replay: true });
  } catch {
    ledger = null;
  }

  const res = await dispatch(event);

  // Only a 200 marks the body as done; a 500 must stay retryable.
  if (res.status === 200 && ledger) {
    try {
      await ledger.from('webhook_events' as never).insert({
        body_hash: hash,
        event_name: typeof event.event === 'string' ? event.event : null,
      } as never);
    } catch {
      // Best-effort: a failed ledger write only means a future replay would
      // reprocess — and the per-flow idempotency guards absorb that.
    }
  }
  return res;
}
