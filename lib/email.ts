import 'server-only';

// Transactional email via Resend (https://resend.com). Uses RESEND_API_KEY
// (server-only). FAILS OPEN by design: if the key is absent (preview/dev) or
// the API errors, sendEmail returns { ok:false } without throwing. Email here is
// a notification / second-line-of-defense channel, never an authorization gate,
// so a delivery problem must never break the action that triggered it.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Verified sender. RESEND_FROM overrides; otherwise noreply@<root domain>.
// (Deliverability needs that domain verified in Resend — a mismatch just makes
// the API return an error, which we swallow, so it degrades to "no email sent".)
function fromAddress(): string {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM;
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN
    || process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    || 'gymflow.ng';
  return `GymFlow <noreply@${root}>`;
}

export type SendEmailResult = { ok: boolean; skipped?: boolean; error?: string };

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };
  const to = (Array.isArray(params.to) ? params.to : [params.to]).map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, skipped: true };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Minimal HTML escape for interpolating user-controlled strings (gym name, staff
// name) into an email body without breaking markup or allowing injection.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
