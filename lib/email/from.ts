// From-header + sender-domain construction for transactional email.
//
// Deliberately NOT 'server-only': this is pure string logic (it only reads
// process.env), so the vitest suite exercises it directly — the same testability
// split the rest of lib/email uses (columns.ts out of recipients.ts, brand.ts
// out of send.ts). lib/email/index.ts re-exports gymFromAddress from here so
// callers keep importing it from '@/lib/email'.
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

/** Plausible-address gate. Anything failing it is dropped before it reaches the
 *  Resend API: profiles.email is nullable and has held junk from CSV imports,
 *  and a comma inside a "recipient" would smuggle in extra envelope recipients. */
export const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

/** Root domain all platform mail is sent from. Must be verified in Resend. */
export function rootDomain(): string {
  return (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
    || process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    || 'gymflow.ng'
  ).toLowerCase();
}

/** Domain gym-branded mail is sent from. Defaults to the root domain; point it
 *  at a dedicated verified subdomain to isolate tenant sending reputation. */
export function tenantDomain(): string {
  return (process.env.EMAIL_TENANT_DOMAIN || rootDomain()).toLowerCase();
}

// Verified platform sender. RESEND_FROM overrides; otherwise noreply@<root>.
// (Deliverability needs that domain verified in Resend — a mismatch just makes
// the API return an error, which we swallow, so it degrades to "no email sent".)
export function platformFrom(): string {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM;
  return `GymFlow <noreply@${rootDomain()}>`;
}

/**
 * Reduce a gym-supplied display name to a phrase that is safe — and valid — in a
 * From header.
 *
 * The display name is a gym-supplied string (`gyms.name`). A CR/LF in it is a
 * classic header-injection: the remainder of the name becomes a new header, so
 * `Iron Gym\r\nBcc: everyone@…` would silently add recipients. Beyond that, the
 * name is emitted UNQUOTED before the `<addr-spec>`, so any RFC 5322 "special"
 * breaks the header: a bare comma/semicolon/colon reads as an address-list,
 * group or route delimiter — `CrossFit, Lagos <addr>` parses as two mailboxes,
 * the first with no address — and Resend rejects the whole send, which on the
 * auth path is a 500 → Supabase retry loop, so a member of a gym whose name
 * contains one of these never receives their confirmation / reset mail. Quotes,
 * backslashes and angle brackets would break out of the address form. All are
 * dropped rather than escaped — there is no legitimate use for them in a gym
 * name, and a stripped name still renders as itself.
 */
export function safeDisplayName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["\\<>(),:;@[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** `slug` is [a-z0-9-] by construction, but this is a header value, so verify
 *  rather than trust; anything unexpected falls back to the shared mailbox. */
export function safeLocalPart(slug: string | null | undefined): string {
  const s = (slug ?? '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s) ? s : 'noreply';
}

/** Build the From header for a gym-branded send. */
export function gymFromAddress(gym: { name?: string | null; slug?: string | null }): string {
  const name = safeDisplayName((gym.name ?? '').trim() || 'GymFlow') || 'GymFlow';
  return `${name} <${safeLocalPart(gym.slug)}@${tenantDomain()}>`;
}
