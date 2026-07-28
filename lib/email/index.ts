import 'server-only';

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

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Root domain all platform mail is sent from. Must be verified in Resend. */
function rootDomain(): string {
  return (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
    || process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    || 'gymflow.ng'
  ).toLowerCase();
}

/** Domain gym-branded mail is sent from. Defaults to the root domain; point it
 *  at a dedicated verified subdomain to isolate tenant sending reputation. */
function tenantDomain(): string {
  return (process.env.EMAIL_TENANT_DOMAIN || rootDomain()).toLowerCase();
}

// Verified platform sender. RESEND_FROM overrides; otherwise noreply@<root>.
// (Deliverability needs that domain verified in Resend — a mismatch just makes
// the API return an error, which we swallow, so it degrades to "no email sent".)
function platformFrom(): string {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM;
  return `GymFlow <noreply@${rootDomain()}>`;
}

/**
 * Strip everything that could break — or forge — a From header.
 *
 * The display name is a gym-supplied string (`gyms.name`). A CR/LF in it is a
 * classic header-injection: the remainder of the name becomes a new header, so
 * `Iron Gym\r\nBcc: everyone@…` would silently add recipients. Quotes and
 * backslashes would break out of the quoted-string form. All are dropped
 * rather than escaped — there is no legitimate use for them in a gym name.
 */
function safeDisplayName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["\\<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** `slug` is [a-z0-9-] by construction, but this is a header value, so verify
 *  rather than trust; anything unexpected falls back to the shared mailbox. */
function safeLocalPart(slug: string | null | undefined): string {
  const s = (slug ?? '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s) ? s : 'noreply';
}

/** Build the From header for a gym-branded send. */
export function gymFromAddress(gym: { name?: string | null; slug?: string | null }): string {
  const name = safeDisplayName((gym.name ?? '').trim() || 'GymFlow');
  return `${name} <${safeLocalPart(gym.slug)}@${tenantDomain()}>`;
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

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
};

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
