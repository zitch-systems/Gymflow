import 'server-only';

import { sendEmail, gymFromAddress, supportAddress, type SendEmailResult } from '@/lib/email';
import { gymBrand, platformBrand, gymUrl, siteUrl } from './brand';
import { renderEmail, type Block } from './layout';
import { adminOrNull, isSuppressed, type EmailGym, type EmailContact } from './recipients';

// The single choke point every branded send goes through.
//
// Templates decide *what* to say; this decides whether it may be said at all
// (gym toggles + the recipient's own opt-out), whose name goes on the envelope,
// and which headers make the message a good citizen in an inbox. Putting that
// in one place is what stops a new template from quietly bypassing a toggle —
// the failure mode of the previous design, where each send site re-implemented
// its own gate.

/**
 * Why this email is being sent. Maps to the gym's staff-visible switches in
 * Settings, plus two ungated classes.
 *
 *  receipts  → gyms.notif_payment_receipts
 *  nudges    → gyms.notif_renewal_nudges
 *  classes   → gyms.notif_class_reminders
 *  updates   → gyms.notif_membership_updates
 *  critical  → ungated. Account-state mail a member must receive even if the
 *              gym switched the marketing-ish nudges off: a failed card, an
 *              auto-renew that just ended, credentials for an account someone
 *              else created for them. Follows the deliverPaymentFailed
 *              precedent already set in lib/notify.ts.
 *  platform  → GymFlow ↔ owner/instructor business mail. Contractual (money,
 *              access, security), so it has no per-gym switch by design.
 */
export type EmailCategory = 'receipts' | 'nudges' | 'classes' | 'updates' | 'critical' | 'platform';

const TOGGLE: Record<Exclude<EmailCategory, 'critical' | 'platform'>, keyof EmailGym> = {
  receipts: 'notif_payment_receipts',
  nudges: 'notif_renewal_nudges',
  classes: 'notif_class_reminders',
  updates: 'notif_membership_updates',
};

/**
 * Does the gym allow this category?
 *
 * Pure so the gating matrix is unit-testable without a database — the repo's
 * test suite uses no mocking, so any logic that needs asserting has to be
 * reachable as a pure function.
 *
 * Defaults to ALLOWED when the column is null/absent: the columns are
 * `not null default true`, so a null only happens when a caller's select didn't
 * ask for it, and silently swallowing mail because of a narrow select is a far
 * worse failure than sending one the gym could have switched off.
 */
export function gymAllows(gym: Partial<EmailGym> | null | undefined, category: EmailCategory): boolean {
  if (category === 'critical' || category === 'platform') return true;
  if (!gym) return true;
  return gym[TOGGLE[category]] !== false;
}

/** Does this individual still want non-critical email? */
export function contactAllows(contact: Pick<EmailContact, 'wantsEmail'> | null | undefined, category: EmailCategory): boolean {
  if (category === 'critical' || category === 'platform') return true;
  return contact?.wantsEmail !== false;
}

const SKIPPED: SendEmailResult = { ok: false, skipped: true };

export type GymSendOptions = {
  gym: Partial<EmailGym> & { id?: string; name?: string | null; slug?: string | null };
  to: { email?: string | null; fullName?: string | null; wantsEmail?: boolean };
  category: EmailCategory;
  subject: string;
  blocks: Block[];
  preheader?: string;
  /** Stable per-message key so a webhook retry doesn't double-send. */
  idempotencyKey?: string;
  /** Resend tag value identifying the template, e.g. 'member_receipt'. */
  template: string;
};

/**
 * Send a gym-branded email to one of its members.
 *
 * The member sees the gym: its logo, its colour, its name in the From line, and
 * replies route to the gym's own inbox. GymFlow appears in the footer as the
 * platform of record — that is what makes an unfamiliar sending domain read as
 * legitimate rather than as a phish.
 */
export async function sendGymEmail(opts: GymSendOptions): Promise<SendEmailResult> {
  if (!process.env.RESEND_API_KEY) return SKIPPED;
  const email = (opts.to.email ?? '').trim();
  if (!email) return SKIPPED;
  if (!gymAllows(opts.gym, opts.category)) return SKIPPED;
  if (!contactAllows({ wantsEmail: opts.to.wantsEmail !== false }, opts.category)) return SKIPPED;
  // Even critical mail respects the suppression list: an address that hard
  // bounced or filed a spam complaint is one we must stop touching, and the
  // check fails open so an outage never blocks a genuine send.
  if (await isSuppressed(adminOrNull(), email)) return SKIPPED;

  const brand = gymBrand(opts.gym);
  // Critical mail carries no preferences link: there is no switch that turns
  // off "your payment failed", so offering one would be a lie.
  const preferencesUrl = opts.category === 'critical'
    ? null
    : `${gymUrl(opts.gym.slug)}/dashboard/profile/edit`;

  const { html, text } = renderEmail({
    brand,
    title: opts.subject,
    preheader: opts.preheader,
    blocks: opts.blocks,
    preferencesUrl,
  });

  return sendEmail({
    to: email,
    subject: opts.subject,
    html,
    text,
    from: gymFromAddress(opts.gym),
    // Replies belong to the gym — a member answering "when do you open?" should
    // reach their gym, not a platform mailbox nobody reads.
    replyTo: opts.gym.email ?? undefined,
    headers: {
      ...(preferencesUrl ? { 'List-Unsubscribe': `<${preferencesUrl}>` } : {}),
      // Distinct per gym+template so Gmail doesn't collapse unrelated
      // notifications from the same sender into one thread.
      'X-Entity-Ref-ID': `${opts.template}:${opts.gym.id ?? 'unknown'}`,
    },
    tags: [
      { name: 'template', value: tagValue(opts.template) },
      { name: 'category', value: opts.category },
      { name: 'sender', value: 'gym' },
    ],
    idempotencyKey: opts.idempotencyKey,
  });
}

export type PlatformSendOptions = {
  to: string | string[];
  subject: string;
  blocks: Block[];
  preheader?: string;
  replyTo?: string;
  idempotencyKey?: string;
  template: string;
};

/**
 * Send a GymFlow-branded email — to a gym owner, staff member, instructor or
 * platform admin. GymFlow is the party speaking here (billing, credentials,
 * payouts, security), so no gym branding is applied even when the message is
 * about a specific gym.
 */
export async function sendPlatformEmail(opts: PlatformSendOptions): Promise<SendEmailResult> {
  if (!process.env.RESEND_API_KEY) return SKIPPED;

  // Drop any suppressed addresses from the recipient set — a platform mail to
  // several owners still reaches the reachable ones. Fails open per-address.
  const requested = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((e) => e.trim()).filter(Boolean);
  const admin = adminOrNull();
  const to: string[] = [];
  for (const addr of requested) {
    if (!(await isSuppressed(admin, addr))) to.push(addr);
  }
  if (to.length === 0) return SKIPPED;

  const { html, text } = renderEmail({
    brand: platformBrand(),
    title: opts.subject,
    preheader: opts.preheader,
    blocks: opts.blocks,
    preferencesUrl: null,
  });
  return sendEmail({
    to,
    subject: opts.subject,
    html,
    text,
    replyTo: opts.replyTo ?? supportAddress(),
    headers: { 'X-Entity-Ref-ID': `${opts.template}:platform` },
    tags: [
      { name: 'template', value: tagValue(opts.template) },
      { name: 'category', value: 'platform' },
      { name: 'sender', value: 'platform' },
    ],
    idempotencyKey: opts.idempotencyKey,
  });
}

/** Resend restricts tag values to ASCII letters, digits, underscore and dash;
 *  an invalid tag rejects the whole send, so template keys are normalised
 *  rather than trusted. */
function tagValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'unknown';
}

/** Convenience for templates that link back into the member's dashboard. */
export function memberAppUrl(gym: { slug?: string | null }, path = '/dashboard'): string {
  return `${gymUrl(gym.slug)}${path}`;
}

/** Convenience for platform mail linking into the owner/admin surfaces. */
export function platformAppUrl(path = '/'): string {
  return `${siteUrl()}${path}`;
}
