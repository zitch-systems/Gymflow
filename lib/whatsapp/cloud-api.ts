import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Thin wrapper over the WhatsApp Cloud API send endpoint.
//
// Everything the product sends a member — a menu, a Flow, a renewal reminder,
// a payment link — leaves through `send()` here, so logging, the missing-token
// fail-open and error shaping live in exactly one place.
//
// FAIL-OPEN. Without WHATSAPP_ACCESS_TOKEN every send returns
// { ok: false, skipped: true } instead of throwing. That matches how email and
// SMS already behave in this codebase: a missing integration key must not turn
// a member's action into a 500.

export type WhatsAppSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; skipped?: boolean };

type Admin = SupabaseClient<Database>;

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

/** The number every gym's members message. One WABA fronts the whole platform. */
export function defaultPhoneNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID || null;
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && defaultPhoneNumberId());
}

async function send(params: {
  phoneNumberId: string | null | undefined;
  to: string;
  message: Record<string, unknown>;
}): Promise<WhatsAppSendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { ok: false, skipped: true, error: 'WHATSAPP_ACCESS_TOKEN is not set' };
  const phoneNumberId = params.phoneNumberId || defaultPhoneNumberId();
  if (!phoneNumberId) return { ok: false, skipped: true, error: 'WhatsApp phone number ID is missing' };

  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, ...params.message }),
      cache: 'no-store',
      signal: AbortSignal.timeout?.(10_000),
    });
  } catch (e) {
    // Network failure or timeout. Surfaced as a normal error so the caller logs
    // it rather than the whole webhook rejecting and Meta retrying the batch.
    return { ok: false, error: `WhatsApp request failed: ${(e as Error).message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Meta ${res.status}: ${body.slice(0, 500)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
  return { ok: true, messageId: json.messages?.[0]?.id ?? null };
}

// WhatsApp hard-caps a text body at 4096 characters and silently rejects the
// whole message above it, so truncate rather than lose the send.
const BODY_MAX = 4096;

export async function sendWhatsAppText(params: {
  phoneNumberId?: string | null;
  to: string;
  body: string;
  previewUrl?: boolean;
}): Promise<WhatsAppSendResult> {
  return send({
    phoneNumberId: params.phoneNumberId,
    to: params.to,
    message: {
      type: 'text',
      // Link previews on by default: most of what we send with a URL is a
      // payment or app link, and a preview makes it obviously ours.
      text: { preview_url: params.previewUrl ?? true, body: params.body.slice(0, BODY_MAX) },
    },
  });
}

export type ReplyButton = { id: string; title: string };

/**
 * Up to three quick-reply buttons. Titles are capped at 20 characters by Meta
 * and a longer one rejects the message, so they are truncated here rather than
 * trusted to every call site.
 */
export async function sendWhatsAppButtons(params: {
  phoneNumberId?: string | null;
  to: string;
  body: string;
  buttons: ReplyButton[];
  header?: string;
  footer?: string;
}): Promise<WhatsAppSendResult> {
  return send({
    phoneNumberId: params.phoneNumberId,
    to: params.to,
    message: {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(params.header ? { header: { type: 'text', text: params.header.slice(0, 60) } } : {}),
        body: { text: params.body.slice(0, 1024) },
        ...(params.footer ? { footer: { text: params.footer.slice(0, 60) } } : {}),
        action: {
          buttons: params.buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
          })),
        },
      },
    },
  });
}

export type ListRow = { id: string; title: string; description?: string };

/** A tappable list — used for the main menu and the membership-package picker. */
export async function sendWhatsAppList(params: {
  phoneNumberId?: string | null;
  to: string;
  body: string;
  buttonLabel: string;
  rows: ListRow[];
  header?: string;
  footer?: string;
  sectionTitle?: string;
}): Promise<WhatsAppSendResult> {
  return send({
    phoneNumberId: params.phoneNumberId,
    to: params.to,
    message: {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(params.header ? { header: { type: 'text', text: params.header.slice(0, 60) } } : {}),
        body: { text: params.body.slice(0, 1024) },
        ...(params.footer ? { footer: { text: params.footer.slice(0, 60) } } : {}),
        action: {
          button: params.buttonLabel.slice(0, 20),
          sections: [{
            title: (params.sectionTitle ?? 'Options').slice(0, 24),
            // Meta allows 10 rows per section.
            rows: params.rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          }],
        },
      },
    },
  });
}

/**
 * Open a Meta Flow. `flowToken` is our own handle for the run — the Flow
 * endpoint receives it back on every screen exchange, which is how a submission
 * is tied to the WhatsApp number that started it.
 */
export async function sendWhatsAppFlow(params: {
  phoneNumberId?: string | null;
  to: string;
  flowId: string;
  flowToken: string;
  ctaLabel: string;
  body: string;
  header?: string;
  footer?: string;
  screen: string;
  data?: Record<string, unknown>;
}): Promise<WhatsAppSendResult> {
  return send({
    phoneNumberId: params.phoneNumberId,
    to: params.to,
    message: {
      type: 'interactive',
      interactive: {
        type: 'flow',
        ...(params.header ? { header: { type: 'text', text: params.header.slice(0, 60) } } : {}),
        body: { text: params.body.slice(0, 1024) },
        ...(params.footer ? { footer: { text: params.footer.slice(0, 60) } } : {}),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: params.flowToken,
            flow_id: params.flowId,
            flow_cta: params.ctaLabel.slice(0, 20),
            // 'navigate' hands the client an entry screen and its initial data;
            // every subsequent screen comes from our data-exchange endpoint.
            flow_action: 'navigate',
            flow_action_payload: { screen: params.screen, ...(params.data ? { data: params.data } : {}) },
          },
        },
      },
    },
  });
}

export type TemplateComponent = {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters: Array<Record<string, unknown>>;
};

/**
 * Approved template — the only thing that may be sent outside Meta's 24-hour
 * customer-service window, which is where every renewal reminder lands.
 */
export async function sendWhatsAppTemplate(params: {
  phoneNumberId?: string | null;
  to: string;
  name: string;
  language?: string;
  components?: TemplateComponent[];
}): Promise<WhatsAppSendResult> {
  return send({
    phoneNumberId: params.phoneNumberId,
    to: params.to,
    message: {
      type: 'template',
      template: {
        name: params.name,
        language: { code: params.language ?? 'en' },
        ...(params.components?.length ? { components: params.components } : {}),
      },
    },
  });
}

/** Mark an inbound message read, so the member sees the blue ticks. */
export async function markRead(params: { phoneNumberId?: string | null; messageId: string }): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = params.phoneNumberId || defaultPhoneNumberId();
  if (!token || !phoneNumberId) return;
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: params.messageId }),
      cache: 'no-store',
      signal: AbortSignal.timeout?.(5_000),
    });
  } catch {
    // Cosmetic. Never worth failing a reply over.
  }
}

// ── Logging ────────────────────────────────────────────────────────────────
// The gym's WhatsApp tab is only as useful as this log, so both directions are
// recorded — including failures, which are the ones an owner most needs to see.
// Logging never throws: an insert problem must not swallow a delivered message.

export async function logInbound(
  admin: Admin,
  params: { contactId: string; gymId: string | null; waMessageId: string | null; kind: string; body: string | null; payload?: unknown },
): Promise<void> {
  try {
    await admin.from('whatsapp_messages').insert({
      contact_id: params.contactId,
      gym_id: params.gymId,
      wa_message_id: params.waMessageId,
      direction: 'inbound',
      kind: params.kind,
      body: params.body,
      payload: (params.payload ?? null) as never,
      status: 'received',
    });
  } catch (e) {
    console.error('[whatsapp] inbound log failed:', (e as Error).message);
  }
}

export async function logOutbound(
  admin: Admin,
  params: {
    contactId: string; gymId: string | null; kind: string; body: string | null;
    authoredBy?: string; result: WhatsAppSendResult; payload?: unknown;
  },
): Promise<void> {
  try {
    await admin.from('whatsapp_messages').insert({
      contact_id: params.contactId,
      gym_id: params.gymId,
      wa_message_id: params.result.ok ? params.result.messageId : null,
      direction: 'outbound',
      kind: params.kind,
      body: params.body,
      payload: (params.payload ?? null) as never,
      authored_by: params.authoredBy ?? 'menu',
      status: params.result.ok ? 'sent' : params.result.skipped ? 'skipped' : 'failed',
      error: params.result.ok ? null : params.result.error,
    });
    if (params.result.ok) {
      await admin
        .from('whatsapp_contacts')
        .update({ last_outbound_at: new Date().toISOString() })
        .eq('id', params.contactId);
    }
  } catch (e) {
    console.error('[whatsapp] outbound log failed:', (e as Error).message);
  }
}
