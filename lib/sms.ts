import 'server-only';
import { normalizeNgPhone } from '@/lib/format';

// WhatsApp / SMS delivery via Termii (https://termii.com) — the NGN-market
// provider. Mirrors lib/email.ts's posture exactly: FAILS OPEN by design. If
// TERMII_API_KEY is absent (preview/dev) or the API errors, sendMessage
// returns { ok:false } without throwing — messaging is a notification channel,
// never an authorization gate, so a delivery problem must never break the
// action that triggered it.

const TERMII_ENDPOINT = 'https://api.ng.termii.com/api/sms/send';

export type SendMessageResult = { ok: boolean; skipped?: boolean; error?: string };

// Termii wants international digits (2348031234567). Members enter local
// Nigerian forms — reuse the shared normalizer, then swap the leading 0.
export function toIntlNgPhone(raw: string | null | undefined): string | null {
  const local = normalizeNgPhone(raw);
  return local ? `234${local.slice(1)}` : null;
}

// channel: 'whatsapp' delivers over WhatsApp; 'dnd' forces SMS delivery even
// to numbers on Nigeria's Do-Not-Disturb register (transactional traffic).
export async function sendMessage(params: {
  to: string; // any Nigerian phone form — normalized internally
  body: string;
  channel?: 'whatsapp' | 'dnd' | 'generic';
}): Promise<SendMessageResult> {
  const key = process.env.TERMII_API_KEY;
  if (!key) return { ok: false, skipped: true };
  const to = toIntlNgPhone(params.to);
  if (!to) return { ok: false, skipped: true, error: 'unusable phone number' };
  try {
    const res = await fetch(TERMII_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        to,
        from: process.env.TERMII_SENDER_ID || 'GymFlow',
        sms: params.body,
        type: 'plain',
        channel: params.channel ?? 'whatsapp',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout?.(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Termii ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
