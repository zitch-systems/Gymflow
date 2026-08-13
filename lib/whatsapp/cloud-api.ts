import 'server-only';

export type WhatsAppSendResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

export async function sendWhatsAppText(params: {
  phoneNumberId: string | null | undefined;
  to: string;
  body: string;
}): Promise<WhatsAppSendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { ok: false, skipped: true, error: 'WHATSAPP_ACCESS_TOKEN is not set' };
  if (!params.phoneNumberId) return { ok: false, skipped: true, error: 'WhatsApp phone number ID is missing' };

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${params.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: {
        preview_url: false,
        body: params.body.slice(0, 4096),
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout?.(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Meta ${res.status}: ${body.slice(0, 500)}` };
  }
  return { ok: true };
}
