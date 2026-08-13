import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/whatsapp/cloud-api';
import { extractMessages, replyForWhatsAppMessage, verifyMetaSignature } from '@/lib/whatsapp/flow';
import { captureServerEvent } from '@/lib/server-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

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
  if (messages.length === 0) return NextResponse.json({ received: true });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'WhatsApp webhook database client is not configured.' }, { status: 501 });
  }

  for (const message of messages) {
    try {
      const reply = await replyForWhatsAppMessage(admin, message);
      const result = await sendWhatsAppText({ phoneNumberId: message.phoneNumberId, to: message.from, body: reply });
      if (!result.ok) {
        console.error(`[whatsapp/webhook] reply failed: ${result.error}`);
        void captureServerEvent('whatsapp webhook reply failed', { error: result.error, skipped: result.skipped ?? false });
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'unknown error';
      console.error(`[whatsapp/webhook] message handling failed: ${error}`);
      void captureServerEvent('whatsapp webhook message handling failed', { error });
    }
  }

  return NextResponse.json({ received: true });
}
