import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractMessages, extractStatuses, verifyMetaSignature } from '@/lib/whatsapp/inbound';
import { handleInboundMessage } from '@/lib/whatsapp/router';
import { captureServerEvent } from '@/lib/server-error';

// Meta's inbound webhook for the WhatsApp Cloud API.
//
// Two jobs: prove the request came from Meta, then hand each message to the
// router. Everything about what to SAY lives in lib/whatsapp/router.ts.
//
// ALWAYS 200. Meta retries any non-2xx by redelivering the entire batch, which
// would replay messages that were already answered — a member could be checked
// in twice, or receive the same payment link three times. So a failure on one
// message is logged and the batch is acknowledged. The one exception is a bad
// signature, which must be rejected.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) return new NextResponse('WhatsApp webhook is not configured.', { status: 501 });

  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Malformed payload.' }, { status: 400 });
  }

  const messages = extractMessages(payload);
  const statuses = extractStatuses(payload);
  if (messages.length === 0 && statuses.length === 0) return NextResponse.json({ received: true });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'WhatsApp webhook database client is not configured.' }, { status: 501 });
  }

  // Sequential, not parallel: two messages from the same person mutate the same
  // contact row, and the conversation only makes sense in the order it was sent.
  for (const message of messages) {
    try {
      await handleInboundMessage(admin, message);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'unknown error';
      console.error(`[whatsapp/webhook] message handling failed: ${error}`);
      void captureServerEvent('whatsapp webhook message handling failed', { error });
    }
  }

  // Delivery receipts. Best-effort — the admin tab showing "sent" instead of
  // "delivered" is not worth a retry storm.
  for (const status of statuses) {
    try {
      await admin
        .from('whatsapp_messages')
        .update({ status: status.status, ...(status.errorTitle ? { error: status.errorTitle } : {}) })
        .eq('wa_message_id', status.messageId)
        .eq('direction', 'outbound');
    } catch (e) {
      // Still best-effort — a delivery receipt is not worth failing the
      // webhook over — but no longer invisible. A tenant-wide auth or schema
      // failure here freezes every outbound message on "sent" forever, and
      // an empty catch made that indistinguishable from "nothing to update".
      const error = e instanceof Error ? e.message : 'unknown error';
      console.error(`[whatsapp/webhook] status update failed: ${error}`);
      void captureServerEvent('whatsapp status update failed', { error });
    }
  }

  return NextResponse.json({ received: true });
}
