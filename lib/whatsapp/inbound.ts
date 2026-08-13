import { createHmac, timingSafeEqual } from 'crypto';

// Parsing what Meta posts to the webhook.
//
// Pure functions, no I/O, and deliberately free of a `server-only` import — the
// routing logic in router.ts is hard enough to reason about without the payload
// shape mixed into it, and this way every shape is unit-testable without a
// database, matching how the paystack event guards are split out.

export type InboundKind = 'text' | 'button' | 'list' | 'flow' | 'template_button' | 'other';

export type IncomingWhatsAppMessage = {
  from: string;
  phoneNumberId: string;
  messageId: string | null;
  kind: InboundKind;
  /** Human-readable text: what they typed, or the label of what they tapped. */
  text: string;
  /** Machine identifier for a tap: the button/list row id we set when sending. */
  actionId: string | null;
  /** Decoded Flow completion payload, for kind 'flow'. */
  flowResponse: Record<string, unknown> | null;
  contactName: string | null;
  timestamp: string | null;
};

export type DeliveryStatus = {
  messageId: string;
  status: string;
  recipientId: string | null;
  errorTitle: string | null;
};

/**
 * Verify Meta's X-Hub-Signature-256.
 *
 * Returns true when no app secret is configured, matching how the rest of this
 * codebase treats unconfigured integrations — but note this one is a security
 * boundary, so META_APP_SECRET should always be set in production. It is
 * documented as required in .env.example for that reason.
 */
export function verifyMetaSignature(raw: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(header.slice('sha256='.length), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;

export function extractMessages(payload: Json): IncomingWhatsAppMessage[] {
  const out: IncomingWhatsAppMessage[] = [];

  for (const entry of arr(payload.entry)) {
    for (const change of arr((entry as Json).changes)) {
      const value = ((change as Json).value as Json | undefined) ?? {};
      const phoneNumberId = str((value.metadata as Json | undefined)?.phone_number_id);
      if (!phoneNumberId) continue;

      // Meta sends the sender's WhatsApp profile name alongside the message
      // rather than inside it.
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str((c as Json).wa_id);
        const name = str(((c as Json).profile as Json | undefined)?.name);
        if (waId && name) names.set(waId, name);
      }

      for (const raw of arr(value.messages)) {
        const msg = raw as Json;
        const from = str(msg.from);
        if (!from) continue;
        const parsed = parseMessage(msg);
        if (!parsed) continue;
        out.push({
          from,
          phoneNumberId,
          messageId: str(msg.id),
          contactName: names.get(from) ?? null,
          timestamp: str(msg.timestamp),
          ...parsed,
        });
      }
    }
  }
  return out;
}

function parseMessage(msg: Json): Pick<IncomingWhatsAppMessage, 'kind' | 'text' | 'actionId' | 'flowResponse'> | null {
  const type = str(msg.type);

  if (type === 'text') {
    const body = str((msg.text as Json | undefined)?.body);
    return body ? { kind: 'text', text: body, actionId: null, flowResponse: null } : null;
  }

  if (type === 'interactive') {
    const interactive = (msg.interactive as Json | undefined) ?? {};
    const itype = str(interactive.type);

    if (itype === 'button_reply') {
      const reply = (interactive.button_reply as Json | undefined) ?? {};
      const id = str(reply.id);
      return id ? { kind: 'button', text: str(reply.title) ?? id, actionId: id, flowResponse: null } : null;
    }

    if (itype === 'list_reply') {
      const reply = (interactive.list_reply as Json | undefined) ?? {};
      const id = str(reply.id);
      return id ? { kind: 'list', text: str(reply.title) ?? id, actionId: id, flowResponse: null } : null;
    }

    // A completed Flow arrives as nfm_reply with the terminal screen's payload
    // JSON-encoded in a string field.
    if (itype === 'nfm_reply') {
      const reply = (interactive.nfm_reply as Json | undefined) ?? {};
      const rawJson = str(reply.response_json);
      let decoded: Record<string, unknown> | null = null;
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson) as unknown;
          if (parsed && typeof parsed === 'object') decoded = parsed as Record<string, unknown>;
        } catch {
          // A Flow reply we cannot parse is still a signal that the member
          // finished; treat it as a bare completion rather than dropping it.
          decoded = null;
        }
      }
      return { kind: 'flow', text: str(reply.body) ?? 'Form submitted', actionId: null, flowResponse: decoded };
    }

    return null;
  }

  // Quick-reply button on a template message (used by renewal reminders).
  if (type === 'button') {
    const button = (msg.button as Json | undefined) ?? {};
    const payloadId = str(button.payload);
    return payloadId
      ? { kind: 'template_button', text: str(button.text) ?? payloadId, actionId: payloadId, flowResponse: null }
      : null;
  }

  // Images, audio, location, stickers, contacts. We do not act on these, but
  // returning them lets the router send a friendly "I can't read that" rather
  // than an unnerving silence.
  if (type) return { kind: 'other', text: '', actionId: null, flowResponse: null };
  return null;
}

/** Delivery receipts, so the admin tab can show sent → delivered → read. */
export function extractStatuses(payload: Json): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  for (const entry of arr(payload.entry)) {
    for (const change of arr((entry as Json).changes)) {
      const value = ((change as Json).value as Json | undefined) ?? {};
      for (const raw of arr(value.statuses)) {
        const s = raw as Json;
        const id = str(s.id);
        const status = str(s.status);
        if (!id || !status) continue;
        const errors = arr(s.errors);
        out.push({
          messageId: id,
          status,
          recipientId: str(s.recipient_id),
          errorTitle: errors.length ? str((errors[0] as Json).title) : null,
        });
      }
    }
  }
  return out;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}
