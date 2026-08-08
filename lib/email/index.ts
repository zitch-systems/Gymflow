import 'server-only';

import { EMAIL_RE, platformFrom } from './from';

// Transactional email via Resend (https://resend.com). Uses RESEND_API_KEY
// (server-only). FAILS OPEN by design: if the key is absent (preview/dev) or
// the API errors, sendEmail returns { ok:false } without throwing. Email here is
// a notification / second-line-of-defense channel, never an authorization gate,
// so a delivery problem must never break the action that triggered it.
//
// The one exception is the Supabase auth hook (app/api/auth/email-hook), where
// the mail IS the flow — it inspects the result and returns a non-2xx so
// Supabase surfaces the failure instead of stranding a user with no link.
//
// SENDER IDENTITY
// Resend verifies *domains*, not mailboxes, so a gym cannot send from its own
// domain unless that domain is verified in our Resend account. What we can do
// on one verified domain is give every gym its own local part and display
// name — `"Iron Republic" <iron-republic@gymflow.ng>` — so a member sees their
// gym in the From line rather than a platform address they don't recognise.
// EMAIL_TENANT_DOMAIN exists so gym mail can be moved to a separate verified
// subdomain later (see docs/EMAIL.md): shared-domain reputation means one gym's
// spam complaints would otherwise degrade delivery of our password-reset mail.

export * from './brand';
export * from './layout';
// gymFromAddress moved to ./from (pure, test-importable); re-exported so callers
// keep importing it from '@/lib/email'.
export { gymFromAddress } from './from';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type SendEmailResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Full From header. Defaults to the platform sender. Use gymFromAddress()
   *  to build a gym-branded one. */
  from?: string;
  replyTo?: string | string[];
  /** Extra MIME headers — List-Unsubscribe, threading hints. */
  headers?: Record<string, string>;
  /** Resend tags for per-category analytics. Values are restricted by Resend
   *  to ASCII letters, digits, underscore and dash. */
  tags?: Array<{ name: string; value: string }>;
  /** Makes a retry of the same logical email a no-op on Resend's side. */
  idempotencyKey?: string;
  /** Files to attach. `content` is the raw bytes — base64 encoding happens
   *  here, once, so no caller has to remember Resend wants it that way.
   *  Resend caps a message at ~40MB including encoding overhead, and base64
   *  inflates by a third; sendEmail refuses anything over ATTACHMENT_LIMIT
   *  rather than letting the API reject the whole send. */
  attachments?: Array<{ filename: string; content: Uint8Array }>;
};

/** Raw-bytes ceiling for attachments on one message. Resend's documented limit
 *  is ~40MB on the encoded payload; base64 costs ~4/3, so this is the largest
 *  input that reliably fits with room for the HTML body. */
export const ATTACHMENT_LIMIT = 25 * 1024 * 1024;

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };

  // Drop anything that isn't plausibly an address before it reaches the API:
  // profiles.email is nullable and has held junk from CSV imports, and a
  // comma inside a "recipient" would smuggle in extra envelope recipients.
  const to = (Array.isArray(params.to) ? params.to : [params.to])
    .map((e) => (e ?? '').trim())
    .filter((e) => EMAIL_RE.test(e));
  if (to.length === 0) return { ok: false, skipped: true };

  const replyTo = params.replyTo
    ? (Array.isArray(params.replyTo) ? params.replyTo : [params.replyTo])
      .map((e) => e.trim()).filter((e) => EMAIL_RE.test(e))
    : [];

  // Refuse an oversized attachment here rather than letting Resend reject the
  // whole message: the caller (a backup run) needs to know its file was too
  // big to mail, which is a different outcome from "the email failed".
  const attachments = params.attachments ?? [];
  const attachmentBytes = attachments.reduce((n, a) => n + a.content.byteLength, 0);
  if (attachmentBytes > ATTACHMENT_LIMIT) {
    return { ok: false, error: `attachments total ${attachmentBytes} bytes, over the ${ATTACHMENT_LIMIT} limit` };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: params.from || platformFrom(),
        to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(replyTo.length ? { reply_to: replyTo } : {}),
        ...(params.headers && Object.keys(params.headers).length ? { headers: params.headers } : {}),
        ...(params.tags?.length ? { tags: params.tags } : {}),
        ...(attachments.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) }
          : {}),
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, ...(json?.id ? { id: json.id } : {}) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Recipients for GymFlow's own operational alerts (contact form, underpayment).
 * Unset means "no one is paged" and the alert is skipped — same fail-open
 * posture as the rest of the module; an unset env var must not throw inside a
 * payment webhook.
 */
export function platformAlertRecipients(): string[] {
  return (process.env.PLATFORM_ALERT_EMAILS ?? '')
    .split(',').map((e) => e.trim()).filter((e) => EMAIL_RE.test(e));
}
