// Authentication email — the messages Supabase Auth would otherwise send from
// its own default templates.
//
// Supabase's built-in auth mail is unbranded, is rate-limited to a handful an
// hour without custom SMTP, and cannot know whether the person confirming an
// address is a gym owner buying GymFlow or a member joining Iron Republic. The
// Send Email hook (app/api/auth/email-hook) takes those sends over and routes
// them through here instead, so a member's confirmation link arrives wearing
// their gym's logo and a gym From line, while an owner's arrives from GymFlow.
//
// Pure functions, no I/O: the hook resolves branding and builds the absolute
// links, these only decide what the message says.

import {
  button, callout, code, h1, link, p, small, strong, t,
  type EmailContent,
} from '../layout';

/** Every auth mail says who it is for; a bare "Hi there" on a security email
 *  reads as a phish. Falls back gracefully when we only have an address. */
function greeting(name: string | null | undefined, email: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || email.split('@')[0] || 'there';
}

/** Copy shared by every link-based auth mail: the link is single-use and short
 *  lived, and a link the recipient didn't ask for is safe to ignore. Stated
 *  once, consistently, so the reassurance is recognisable across messages. */
function linkFooter(expiryHint: string, unsolicited: string): ReturnType<typeof small>[] {
  return [
    small(t`This link can only be used once and expires ${expiryHint}.`),
    small(t`${unsolicited}`),
  ];
}

export type AuthArgs = {
  /** Who is being written to. */
  email: string;
  fullName?: string | null;
  /** Absolute, already-built action URL. */
  actionUrl: string;
  /** Name in the copy: the gym for a member, "GymFlow" for an owner/staff. */
  senderName: string;
  /** True when the recipient is a member of a gym rather than a GymFlow customer. */
  isGymMember: boolean;
};

/**
 * Confirm a new sign-up.
 *
 * For a gym owner this is now the critical path, not a formality: signup
 * creates the auth account and nothing else, and the gym itself is provisioned
 * only when this link is opened (lib/auth/actions.ts). Member joins still
 * auto-confirm server-side (lib/actions/join.ts) — a member arriving from a
 * gym's invite link has already been vouched for by the gym.
 */
export function confirmSignup(a: AuthArgs): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: a.isGymMember
      ? `Confirm your email to finish joining ${a.senderName}`
      : 'Confirm your email to finish setting up GymFlow',
    preheader: 'One tap and your account is ready.',
    blocks: [
      h1(t`Confirm your email`),
      p(t`Hi ${who}, ${a.isGymMember ? t`you're almost a member at ${strong(a.senderName)}.` : t`your GymFlow workspace is almost ready.`}`),
      p(t`Tap the button below to confirm ${strong(a.email)} and finish setting up your account.`),
      button('Confirm your email', a.actionUrl),
      ...linkFooter('in 24 hours', `If you didn't create this account, you can ignore this email — nothing will happen without confirmation.`),
    ],
  };
}

/**
 * Password reset.
 *
 * The one auth mail that is always delivered for real (nothing auto-confirms
 * it), so it carries the most weight — and it is the message an attacker would
 * most like to imitate. Hence the explicit "we will never ask" line and the
 * plain statement that ignoring it leaves the password unchanged.
 */
export function resetPassword(a: AuthArgs): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: 'Reset your password',
    preheader: 'The link works once and expires in an hour.',
    blocks: [
      h1(t`Reset your password`),
      p(t`Hi ${who}, we got a request to reset the password for ${strong(a.email)}.`),
      p(t`Choose a new one here:`),
      button('Set a new password', a.actionUrl),
      callout('warning', t`If you didn't ask for this, ignore this email — your password stays exactly as it is. Nobody can reset it without opening the link above.`),
      small(t`This link can only be used once and expires in 1 hour.`),
      small(t`${a.senderName} will never ask you for your password by email or WhatsApp.`),
    ],
  };
}

/** Magic-link sign-in. Not reachable from the current UI, but the hook must
 *  never send a blank message if someone enables passwordless later. */
export function magicLink(a: AuthArgs): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: `Your sign-in link${a.isGymMember ? ` for ${a.senderName}` : ''}`,
    preheader: 'Signs you in on this device — no password needed.',
    blocks: [
      h1(t`Sign in`),
      p(t`Hi ${who}, here's your sign-in link for ${strong(a.email)}.`),
      button('Sign in', a.actionUrl),
      ...linkFooter('in 1 hour', `If you didn't try to sign in, ignore this email and consider changing your password.`),
    ],
  };
}

/** Invitation to an account someone else created. */
export function inviteUser(a: AuthArgs): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: `${a.senderName} invited you to GymFlow`,
    preheader: 'Set a password and you’re in.',
    blocks: [
      h1(t`You've been invited`),
      p(t`Hi ${who}, ${strong(a.senderName)} set up a GymFlow account for ${strong(a.email)}.`),
      p(t`Accept the invitation and choose your password:`),
      button('Accept the invitation', a.actionUrl),
      ...linkFooter('in 24 hours', `If you weren't expecting this, you can ignore it — the account stays inactive until you accept.`),
    ],
  };
}

/**
 * Email-change confirmation. Supabase sends this to BOTH the old and the new
 * address; `toNewAddress` picks the right copy, because the two readers need
 * opposite things — one is confirming an intent, the other is a security
 * notice to someone who may be losing access to the account.
 */
export function changeEmail(a: AuthArgs & { newEmail: string; toNewAddress: boolean }): EmailContent {
  const who = greeting(a.fullName, a.email);
  if (a.toNewAddress) {
    return {
      subject: 'Confirm your new email address',
      preheader: 'Confirm here and this becomes your sign-in address.',
      blocks: [
        h1(t`Confirm your new address`),
        p(t`Hi ${who}, confirm ${strong(a.newEmail)} to make it the address you sign in with.`),
        button('Confirm this address', a.actionUrl),
        ...linkFooter('in 24 hours', `If you didn't request this change, ignore this email and the address stays as it was.`),
      ],
    };
  }
  return {
    subject: 'Confirm the change to your email address',
    preheader: 'Approve the change from your current address.',
    blocks: [
      h1(t`Approve your email change`),
      p(t`Hi ${who}, we got a request to change the address on your account from ${strong(a.email)} to ${strong(a.newEmail)}.`),
      p(t`Approve it here — both addresses have to confirm before the change takes effect:`),
      button('Approve the change', a.actionUrl),
      callout('warning', t`If you didn't ask for this, do not approve it, and change your password now — someone else may have access to your account.`),
    ],
  };
}

/**
 * Sign-in second factor: a 6-digit code for gym staff.
 *
 * Not a link. A magic link in a 2FA mail would let anyone who can read the
 * inbox complete a sign-in with one click from any device; a code has to be
 * typed into the session that already passed the password, which is the whole
 * point of the second factor. The code goes in the subject too, so it can be
 * read from a phone's lock screen without opening the message.
 */
export function twoFactorCode(a: { code: string; minutes: number; fullName?: string | null; email?: string | null }): EmailContent {
  const who = greeting(a.fullName, a.email ?? '');
  return {
    subject: `${a.code} is your GymFlow sign-in code`,
    preheader: `Enter this code to finish signing in. It expires in ${a.minutes} minutes.`,
    blocks: [
      h1(t`Finish signing in`),
      p(t`Hi ${who}, someone entered your password on the GymFlow sign-in page. Enter this code to continue:`),
      code(a.code),
      small(t`The code expires in ${String(a.minutes)} minutes and can only be used once.`),
      callout('warning', t`If this wasn't you, someone knows your password. Don't enter the code — change your password now and tell your gym owner.`),
    ],
  };
}

/** Step-up re-authentication: a 6-digit code, not a link. */
export function reauthentication(a: Omit<AuthArgs, 'actionUrl'> & { token: string }): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: `${a.token} is your confirmation code`,
    preheader: 'Enter this code to confirm it’s you.',
    blocks: [
      h1(t`Confirm it's you`),
      p(t`Hi ${who}, enter this code to finish what you started:`),
      code(a.token),
      small(t`The code expires in 10 minutes.`),
      callout('warning', t`If you didn't just try to confirm something, someone may have your password. Change it now.`),
    ],
  };
}

/**
 * Last-resort template for an auth action type we don't have copy for.
 *
 * Supabase can add action types; shipping a fallback means a future one
 * degrades to a plain branded email with a working link, instead of a blank
 * body or — worse — a 500 from the hook that strands the user with no mail at
 * all.
 */
export function genericAuthAction(a: AuthArgs): EmailContent {
  const who = greeting(a.fullName, a.email);
  return {
    subject: 'Confirm your request',
    preheader: 'Finish the action you started.',
    blocks: [
      h1(t`Confirm your request`),
      p(t`Hi ${who}, use the link below to finish the action you started on your account.`),
      button('Continue', a.actionUrl),
      p(t`If the button doesn't work, copy this into your browser: ${link(a.actionUrl, a.actionUrl)}`),
      ...linkFooter('shortly', `If you didn't start this, you can ignore this email.`),
    ],
  };
}
