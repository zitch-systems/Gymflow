// GymFlow-branded mail for the people who RUN gyms: owners, staff, instructors,
// and GymFlow’s own platform admins.
//
// The difference from member mail is who is speaking. Here it is GymFlow —
// billing, credentials, payouts, security — so nothing is dressed in the gym’s
// colours even when the message is about one specific gym. The gym’s NAME still
// appears in nearly every line: an owner may run more than one, and "your payout
// account changed" is useless without saying where.
//
// Every function is a pure function of its arguments: no I/O, no env reads, no
// 'server-only'. Absolute URLs arrive from the caller (platformAppUrl() and
// gymUrl() live on the server side of that fence), which is what lets the test
// suite render these directly.
//
// Escaping is structural, not vigilance-based: gym names, staff names, bank
// names, decline reasons and contact-form bodies all reach these blocks, and all
// of them go through `t` / strong() / link(). `subject` and `preheader` are the
// two plain-text fields — renderEmail escapes them — so they only need the
// one-line guard below.

import {
  bullets, button, callout, code, divider, h1, h2, link, linkLine, naira, p, panel, small, strong, t,
  type EmailContent, type Safe,
} from '../layout';

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Flatten a value to a single line.
 *
 * Subject and preheader are header-shaped fields built from gym- and
 * member-supplied names. A newline pasted into a gym name folds the header at
 * the mail server and truncates the inbox preview — the recipient then never
 * sees the fact the line exists to carry.
 */
function line(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** First name for a greeting. profiles.full_name is nullable and holds CSV
 *  import junk, so "Hi ," is a real outcome without the fallback. */
function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

/** Human form of a gym_staff_links.role enum value. 'front_desk' in the middle
 *  of a sentence reads like a leaked database column, and this text is the whole
 *  point of a role-change email. Unknown values pass through rather than
 *  vanishing — a new enum member should degrade to ugly, not to blank. */
const ROLE_LABELS: Record<string, string> = {
  gym_owner: 'Owner',
  owner: 'Owner',
  manager: 'Manager',
  front_desk: 'Front desk',
  accountant: 'Accountant',
  instructor: 'Instructor',
  member: 'Member',
  platform_admin: 'Platform admin',
};

function roleLabel(role: string): string {
  const key = (role ?? '').trim();
  return ROLE_LABELS[key] ?? (key || 'Staff');
}

/** Bank as it appears on a statement. Only ever the last four digits: the full
 *  account number lives in the database and email is not the place to
 *  re-broadcast it. */
function bankLine(bankName: string, last4: string): Safe {
  return t`${bankName} ••••${last4}`;
}

/** Display form of a URL — host and path, no scheme. A subdomain is the thing an
 *  owner reads out to people; "https://" in the middle of a sentence is noise.
 *  The href stays absolute. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** "today" / "tomorrow" / "in 5 days" — a countdown reads as urgency, a raw
 *  integer reads as a merge field that didn’t fire. */
function inDays(days: number): string {
  const n = Math.round(days);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

// ── Owner / account ──────────────────────────────────────────────────────────

/** Self-serve signup completed: the gym exists, the trial clock is running, and
 *  three things stand between the owner and a working gym. */
export function ownerWelcome(o: {
  ownerName?: string | null;
  gymName: string;
  /** Public tenant URL — https://iron-republic.gymflow.ng */
  gymUrl: string;
  /** Admin console to land in. */
  adminUrl: string;
  /** Already formatted for a Nigerian reader, e.g. '9 August 2026'. */
  trialEndDate: string;
}): EmailContent {
  return {
    subject: line(`${o.gymName} is live on GymFlow`),
    preheader: line(`Your free trial runs to ${o.trialEndDate}. Three things to set up first.`),
    blocks: [
      h1(t`${o.gymName} is live`),
      p(t`Hi ${firstName(o.ownerName)}, your gym is set up. Members can sign up, renew and check in from their phones as soon as you’re ready for them.`),
      panel([
        ['Your gym', t`${o.gymName}`],
        ['Members sign up at', link(displayUrl(o.gymUrl), o.gymUrl)],
        ['Free trial runs to', t`${o.trialEndDate}`],
      ]),
      h2('Do these three first'),
      bullets([
        t`${strong('Add your members')} — bring over the list you already keep. Everyone gets a QR code for check-in.`,
        t`${strong('Set your plans and prices')} — monthly, quarterly, annual, day pass. Whatever you already sell.`,
        t`${strong('Connect Paystack')} — until you do, members can’t renew from their phones and you’re back to chasing transfers.`,
      ]),
      button('Set up your gym', o.adminUrl),
      small('Every feature is on during the trial. Nothing is charged until you pick a plan.'),
    ],
  };
}

/** A superadmin created the gym on the owner’s behalf, so this mail carries the
 *  credentials — which is why it leads with the account and ends on the warning
 *  rather than a feature tour. */
export function ownerGymProvisioned(o: {
  ownerName?: string | null;
  gymName: string;
  /** The address the account signs in with. */
  email: string;
  tempPassword: string;
  signInUrl: string;
  gymUrl?: string | null;
}): EmailContent {
  return {
    subject: line(`Your GymFlow account for ${o.gymName} is ready`),
    preheader: 'Sign in with the temporary password below, then set your own.',
    blocks: [
      h1(t`${o.gymName} is set up`),
      p(t`Hi ${firstName(o.ownerName)}, GymFlow created your gym and an owner account to run it. Sign in with the details below.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Sign-in email', t`${o.email}`],
      ], 'Your account'),
      small('Temporary password'),
      code(o.tempPassword),
      callout('warning', t`Change this password the first time you sign in — it has travelled by email, and email is not a safe place for it to stay.`),
      button('Sign in and set your password', o.signInUrl),
      ...(o.gymUrl ? [linkLine('Your member sign-up page', o.gymUrl)] : []),
    ],
  };
}

/** A gym added this person to its team. They may never have heard of GymFlow, so
 *  the mail says who added them, as what, and how to get in. */
export function staffInvite(o: {
  staffName?: string | null;
  gymName: string;
  /** gym_staff_links.role — 'manager' | 'front_desk' | 'accountant' | 'instructor'. */
  role: string;
  email: string;
  tempPassword: string;
  signInUrl: string;
}): EmailContent {
  const label = roleLabel(o.role);
  return {
    subject: line(`You’ve been added to ${o.gymName} on GymFlow`),
    preheader: line(`Your ${label.toLowerCase()} sign-in is below. The password is temporary.`),
    blocks: [
      h1(t`You’re on the team at ${o.gymName}`),
      p(t`Hi ${firstName(o.staffName)}, ${strong(o.gymName)} added you to their gym on GymFlow as ${strong(label)}. GymFlow is where the gym runs its members, check-ins, classes and payments.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Your role', t`${label}`],
        ['Sign-in email', t`${o.email}`],
      ], 'Your account'),
      small('Temporary password'),
      code(o.tempPassword),
      callout('warning', t`Set your own password the first time you sign in. Anyone who can read this email can read that one.`),
      button('Sign in and set your password', o.signInUrl),
    ],
  };
}

/** An admin reset this account’s password. The credential handoff and the "was
 *  this you?" question belong in the same message — a reset nobody asked for is
 *  how an account takeover looks from the inside. */
export function staffPasswordReset(o: {
  staffName?: string | null;
  gymName: string;
  email: string;
  tempPassword: string;
  signInUrl: string;
  /** https or mailto: link to support, built by the caller. */
  supportUrl: string;
}): EmailContent {
  return {
    subject: 'Your GymFlow password was reset',
    preheader: 'Sign in with the temporary password below, then choose your own.',
    blocks: [
      h1('Your password was reset'),
      p(t`Hi ${firstName(o.staffName)}, an admin at ${strong(o.gymName)} reset the password on your GymFlow account. Your old one no longer works.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Sign-in email', t`${o.email}`],
      ]),
      small('Temporary password'),
      code(o.tempPassword),
      button('Sign in and set a new password', o.signInUrl),
      callout('danger', t`Change this password as soon as you’re in. If you didn’t ask for the reset, ${link('contact support', o.supportUrl)} now — someone else may be trying to get into your account.`),
    ],
  };
}

/** Access at one gym switched on or off. Deactivation is the one people query,
 *  so it says plainly what survives: the account, and the data. */
export function staffAccessChanged(o: {
  staffName?: string | null;
  gymName: string;
  active: boolean;
  signInUrl?: string | null;
}): EmailContent {
  if (o.active) {
    return {
      subject: line(`Your access to ${o.gymName} is back on`),
      preheader: 'Sign in with the password you already use — nothing has changed there.',
      blocks: [
        h1('Your access is back on'),
        p(t`Hi ${firstName(o.staffName)}, ${strong(o.gymName)} switched your access back on. Everything you could see and do before is there again.`),
        ...(o.signInUrl ? [button('Sign in to GymFlow', o.signInUrl)] : []),
      ],
    };
  }
  return {
    subject: line(`Your access to ${o.gymName} has been turned off`),
    preheader: 'Your account still exists — it just no longer opens that gym.',
    blocks: [
      h1('Your access has been turned off'),
      p(t`Hi ${firstName(o.staffName)}, ${strong(o.gymName)} turned off your access to their gym on GymFlow. You can still sign in, but the gym’s members, classes and payments are no longer yours to open.`),
      p('Your account and anything you recorded stay exactly as they are. If this looks like a mistake, speak to the gym owner — access is theirs to switch back on.'),
    ],
  };
}

/** Role changed at a gym. The old → new pair is the message: a demotion someone
 *  discovers by finding a page missing is a support ticket. */
export function staffRoleChanged(o: {
  staffName?: string | null;
  gymName: string;
  previousRole: string;
  newRole: string;
  signInUrl?: string | null;
}): EmailContent {
  const now = roleLabel(o.newRole);
  return {
    subject: line(`Your role at ${o.gymName} is now ${now.toLowerCase()}`),
    preheader: 'What you can open in the admin console changes with it.',
    blocks: [
      h1('Your role changed'),
      p(t`Hi ${firstName(o.staffName)}, ${strong(o.gymName)} changed your role on GymFlow. What you can see and do in the admin console follows the new one.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Was', t`${roleLabel(o.previousRole)}`],
        ['Now', t`${now}`],
      ]),
      ...(o.signInUrl ? [button('Open your dashboard', o.signInUrl)] : []),
      small('If that role looks wrong, the gym owner can change it back.'),
    ],
  };
}

// ── Platform billing (the gym pays GymFlow) ──────────────────────────────────

/** Receipt for a platform subscription charge. This email IS the paper trail —
 *  the reference is what reconciles it against Paystack. */
export function subscriptionReceipt(o: {
  gymName: string;
  amountNaira: number;
  /** Plan display name — 'Starter' | 'Growth' | 'Scale'. */
  tier: string;
  /** Formatted date the charge went through. */
  paidDate: string;
  /** Formatted date the paid period runs to. */
  periodEnd: string;
  /** Paystack transaction reference. */
  reference: string;
  billingUrl: string;
}): EmailContent {
  return {
    subject: line(`${naira(o.amountNaira).text} received for ${o.gymName}`),
    preheader: line(`${o.tier} plan · paid through ${o.periodEnd}. This email is your receipt.`),
    blocks: [
      h1('Payment received'),
      p(t`Your ${strong(o.tier)} plan for ${strong(o.gymName)} is paid. Nothing to do — this is just the receipt.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Plan', t`${o.tier}`],
        ['Amount', naira(o.amountNaira)],
        ['Paid on', t`${o.paidDate}`],
        ['Paid through', t`${o.periodEnd}`],
        ['Reference', t`${o.reference}`],
      ], 'Receipt'),
      button('See your billing history', o.billingUrl),
      small('Keep this email for your records. Every charge on the gym is listed in billing.'),
    ],
  };
}

/** The card was declined. Says what happens, and by when — a past-due gym that
 *  doesn’t know its deadline finds out when the console locks. */
export function subscriptionPastDue(o: {
  gymName: string;
  amountNaira: number;
  tier: string;
  /** Formatted date of the failed attempt. */
  attemptedDate: string;
  /** Formatted date access is kept until — the end of the paid period. */
  graceEndDate: string;
  billingUrl: string;
}): EmailContent {
  return {
    subject: line(`Your GymFlow payment for ${o.gymName} didn’t go through`),
    preheader: line(`Sort the card by ${o.graceEndDate} and nothing changes.`),
    blocks: [
      h1('Your payment failed'),
      p(t`The ${naira(o.amountNaira)} charge for ${strong(o.gymName)} was declined on ${o.attemptedDate}. Usually it’s an expired card or a daily limit, not the money.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Plan', t`${o.tier}`],
        ['Amount due', naira(o.amountNaira)],
        ['Last tried', t`${o.attemptedDate}`],
      ]),
      callout('warning', t`Your admin console stays open until ${strong(o.graceEndDate)}. After that it locks until a payment goes through. Nothing is deleted, and your members keep their access either way.`),
      button('Update your card', o.billingUrl),
      small('Already paid? Ignore this — a charge can take a few minutes to land.'),
    ],
  };
}

/** Subscription cancelled. Leads with what they keep, because the fear is that
 *  cancelling deleted the gym. */
export function subscriptionCancelled(o: {
  gymName: string;
  /** Formatted date paid access runs to. */
  accessEndDate: string;
  billingUrl: string;
}): EmailContent {
  return {
    subject: line(`Your GymFlow subscription for ${o.gymName} is cancelled`),
    preheader: line(`You keep everything until ${o.accessEndDate}. Nothing is deleted.`),
    blocks: [
      h1('Your subscription is cancelled'),
      p(t`${strong(o.gymName)} won’t be charged again. You’ve already paid through ${strong(o.accessEndDate)}, so the admin console, check-in and reminders all keep running until then.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Access runs until', t`${o.accessEndDate}`],
        ['Next charge', 'None'],
      ]),
      p('After that date the console locks, but your members, check-in history, plans and payments stay where they are. Start the subscription again and everything is exactly as you left it.'),
      button('Restart your subscription', o.billingUrl),
      small('Cancelled by mistake, or something went wrong? Reply to this email — a person reads it.'),
    ],
  };
}

/** Trial running out. The keep/lose split is the whole message — a vague "your
 *  trial is ending" gets ignored until the console locks. */
export function trialEnding(o: {
  gymName: string;
  daysLeft: number;
  /** Formatted date the trial ends. */
  trialEndDate: string;
  billingUrl: string;
}): EmailContent {
  const when = inDays(o.daysLeft);
  return {
    subject: line(`Your GymFlow trial for ${o.gymName} ends ${when}`),
    preheader: 'Pick a plan and nothing stops — same gym, same data, same day.',
    blocks: [
      h1(t`Your trial ends ${when}`),
      p(t`The free trial on ${strong(o.gymName)} runs to ${strong(o.trialEndDate)}. Pick a plan before then and nothing about your gym changes.`),
      h2(t`What happens on ${o.trialEndDate}`),
      bullets([
        t`${strong('You keep')} every member, check-in, class booking and payment record. Nothing is deleted, ever.`,
        t`${strong('You lose')} the admin console, QR check-in, automated reminders and Paystack renewals until you’re on a plan.`,
      ]),
      button('Choose your plan', o.billingUrl),
      small('Every plan is month to month. Change tier or stop whenever your gym does.'),
    ],
  };
}

/** The trial is over and the console is locked. Short by design: the only useful
 *  action is choosing a plan. */
export function trialEnded(o: {
  gymName: string;
  /** Formatted date the trial ended. Optional — recency is what matters. */
  trialEndDate?: string | null;
  billingUrl: string;
}): EmailContent {
  return {
    subject: line(`Your GymFlow trial for ${o.gymName} has ended`),
    preheader: 'Your data is untouched. Pick a plan to open the console again.',
    blocks: [
      h1('Your trial has ended'),
      p(o.trialEndDate
        ? t`The free trial on ${strong(o.gymName)} finished on ${strong(o.trialEndDate)}. The admin console is locked until you’re on a plan.`
        : t`The free trial on ${strong(o.gymName)} has finished. The admin console is locked until you’re on a plan.`),
      p('Nothing has been deleted. Your members, check-in history, plans and payments are exactly where you left them, and they come straight back the moment you pick a plan.'),
      button('Choose your plan', o.billingUrl),
      small('Not sure which tier fits? Reply to this email with your member count and get a straight recommendation.'),
    ],
  };
}

// ── Payouts (money movement) ─────────────────────────────────────────────────

/** An instructor asked to be paid. Goes to owners and managers, because money
 *  only moves after one of them approves it. */
export function payoutRequested(o: {
  gymName: string;
  instructorName: string;
  amountNaira: number;
  bankName: string;
  last4: string;
  /** Formatted date of the request. */
  requestedDate?: string | null;
  payoutsUrl: string;
}): EmailContent {
  return {
    subject: line(`${o.instructorName} requested a ${naira(o.amountNaira).text} payout at ${o.gymName}`),
    preheader: 'Approve it and the transfer goes out through Paystack.',
    blocks: [
      h1('A payout is waiting for you'),
      p(t`${strong(o.instructorName)} requested a payout of ${naira(o.amountNaira)} from ${strong(o.gymName)}. It sits in your payouts page until an owner or manager approves it.`),
      panel([
        ['Instructor', t`${o.instructorName}`],
        ['Amount', naira(o.amountNaira)],
        ['Their bank', bankLine(o.bankName, o.last4)],
        ['Requested', t`${o.requestedDate ?? ''}`],
        ['Gym', t`${o.gymName}`],
      ], 'Payout request'),
      button('Review the payout', o.payoutsUrl),
      small('No money leaves your balance until someone approves it.'),
    ],
  };
}

/** Transfer initiated at Paystack — money in flight, not yet landed. Setting the
 *  expectation here is what stops "you said you paid me" an hour later. */
export function payoutSent(o: {
  instructorName?: string | null;
  gymName: string;
  amountNaira: number;
  bankName: string;
  last4: string;
  /** Paystack transfer reference. */
  reference: string;
  earningsUrl: string;
}): EmailContent {
  return {
    subject: line(`${naira(o.amountNaira).text} is on its way to your bank`),
    preheader: line(`Sent by ${o.gymName}. Most banks land it within minutes.`),
    blocks: [
      h1(t`${naira(o.amountNaira)} is on the way`),
      p(t`Hi ${firstName(o.instructorName)}, ${strong(o.gymName)} sent your payout. It’s with Paystack now, heading to your account.`),
      panel([
        ['Amount', naira(o.amountNaira)],
        ['To', bankLine(o.bankName, o.last4)],
        ['From', t`${o.gymName}`],
        ['Reference', t`${o.reference}`],
      ], 'Payout'),
      p('Most transfers land within minutes. A slow bank can take a few hours — you’ll get another email the moment it clears.'),
      button('See your earnings', o.earningsUrl),
    ],
  };
}

/** Paystack confirmed the transfer settled. The one email an instructor actually
 *  wants, so it says the amount and gets out of the way. */
export function payoutCompleted(o: {
  instructorName?: string | null;
  gymName: string;
  amountNaira: number;
  bankName?: string | null;
  last4?: string | null;
  /** Formatted date it settled. */
  paidDate?: string | null;
  reference?: string | null;
  earningsUrl: string;
}): EmailContent {
  const bank = o.bankName && o.last4 ? bankLine(o.bankName, o.last4) : '';
  return {
    subject: line(`${naira(o.amountNaira).text} has landed in your account`),
    preheader: line(`Paid by ${o.gymName}. Nothing to do.`),
    blocks: [
      h1('Your payout has landed'),
      p(t`Hi ${firstName(o.instructorName)}, your ${naira(o.amountNaira)} payout from ${strong(o.gymName)} is in your bank account.`),
      panel([
        ['Amount', naira(o.amountNaira)],
        ['To', bank],
        ['Paid on', t`${o.paidDate ?? ''}`],
        ['Reference', t`${o.reference ?? ''}`],
      ], 'Payout'),
      button('See your earnings', o.earningsUrl),
      small('Keep this email as your record of the payment.'),
    ],
  };
}

/** The transfer bounced. The reason and the retry path both matter — an
 *  instructor who thinks the money vanished calls the gym, not the bank. */
export function payoutFailed(o: {
  instructorName?: string | null;
  gymName: string;
  amountNaira: number;
  /** Paystack’s reason, verbatim. Rendered escaped. */
  reason: string;
  bankName?: string | null;
  last4?: string | null;
  payoutSettingsUrl: string;
}): EmailContent {
  const bank = o.bankName && o.last4 ? bankLine(o.bankName, o.last4) : '';
  return {
    subject: line(`Your ${naira(o.amountNaira).text} payout didn’t go through`),
    preheader: line(`The money is back with ${o.gymName} and the payout is queued to retry.`),
    blocks: [
      h1('Your payout didn’t go through'),
      p(t`Hi ${firstName(o.instructorName)}, the transfer of ${naira(o.amountNaira)} from ${strong(o.gymName)} failed. The money never left their balance, so nothing is lost.`),
      panel([
        ['Amount', naira(o.amountNaira)],
        ['To', bank],
        ['Reason', t`${o.reason}`],
      ]),
      callout('warning', t`Check your bank details before the retry — a wrong account number or a name that doesn’t match your bank records is the usual cause. The retry uses whatever is saved at the time.`),
      p(t`${strong(o.gymName)} can send it again from their payouts page once that’s sorted.`),
      button('Check your payout details', o.payoutSettingsUrl),
    ],
  };
}

/** A payout request the gym declined. The staff note is the whole content — an
 *  unexplained rejection is a conversation the gym has to have anyway. */
export function payoutRejected(o: {
  instructorName?: string | null;
  gymName: string;
  amountNaira: number;
  /** Staff’s note on the rejection. Free text — rendered escaped. */
  note?: string | null;
  earningsUrl: string;
}): EmailContent {
  const note = (o.note ?? '').trim();
  return {
    subject: line(`Your ${naira(o.amountNaira).text} payout request was declined`),
    preheader: 'Your earnings stay in your balance — you can ask again.',
    blocks: [
      h1('Your payout request was declined'),
      p(t`Hi ${firstName(o.instructorName)}, ${strong(o.gymName)} declined your request for ${naira(o.amountNaira)}.`),
      ...(note ? [callout('info', t`Note from ${o.gymName}: ${note}`)] : []),
      p('Nothing has been taken from your balance. The earnings are still there, and you can request the payout again once you and the gym agree on it.'),
      button('See your earnings', o.earningsUrl),
    ],
  };
}

/** Which change happened to a gym’s payout destination. Same vocabulary as
 *  lib/payout-alerts.ts so the audit trail and the email agree. */
export type PayoutAccountAction = 'added' | 'activated' | 'removed';

const PAYOUT_ACTION: Record<PayoutAccountAction, { subject: string; heading: string; sentence: string }> = {
  added: {
    subject: 'A new payout account was added at',
    heading: 'A payout account was added',
    sentence: 'added a payout account to',
  },
  activated: {
    subject: 'Your payouts now go to a different account at',
    heading: 'Your payout account changed',
    sentence: 'made this the active payout account for',
  },
  removed: {
    subject: 'A payout account was removed at',
    heading: 'A payout account was removed',
    sentence: 'removed a payout account from',
  },
};

/**
 * Owners: the gym’s payout destination changed.
 *
 * This is a security mail, not a notification. The payout account is where every
 * naira a member pays eventually settles, so a hijacked staff session that got
 * past re-auth has to surface somewhere the owner reads — which is why it ends
 * on the danger callout rather than a dashboard link.
 */
export function payoutAccountChanged(o: {
  gymName: string;
  action: PayoutAccountAction;
  bankName: string;
  last4: string;
  /** Display name of whoever made the change. */
  actorName: string;
  /** Formatted date/time of the change. */
  changedAt?: string | null;
  /** https or mailto: link to support, built by the caller. */
  supportUrl: string;
  payoutSettingsUrl?: string | null;
}): EmailContent {
  const copy = PAYOUT_ACTION[o.action];
  return {
    subject: line(`${copy.subject} ${o.gymName}`),
    preheader: line(`${o.bankName} ••••${o.last4} · changed by ${o.actorName}.`),
    blocks: [
      h1(copy.heading),
      p(t`${strong(o.actorName)} ${copy.sentence} ${strong(o.gymName)}. Money from your members settles into whichever account is active, so every owner is told when this changes.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Bank', bankLine(o.bankName, o.last4)],
        ['Changed by', t`${o.actorName}`],
        ['When', t`${o.changedAt ?? ''}`],
      ], 'The change'),
      ...(o.payoutSettingsUrl ? [linkLine('Review your payout settings', o.payoutSettingsUrl)] : []),
      callout('danger', t`If this wasn’t you, ${link('contact support', o.supportUrl)} now — someone may have access to a staff account at your gym.`),
    ],
  };
}

/**
 * Instructors: their own payout bank changed.
 *
 * Same posture as payoutAccountChanged and for the same reason — this is the
 * account their earnings land in, and the person best placed to spot a change
 * they didn’t make is the one being paid.
 */
export function instructorBankChanged(o: {
  instructorName?: string | null;
  gymName: string;
  bankName: string;
  last4: string;
  /** https or mailto: link to support, built by the caller. */
  supportUrl: string;
  payoutSettingsUrl?: string | null;
}): EmailContent {
  return {
    subject: 'Your payout account was changed',
    preheader: line(`Future payouts from ${o.gymName} go to ${o.bankName} ••••${o.last4}.`),
    blocks: [
      h1('Your payout account was changed'),
      p(t`Hi ${firstName(o.instructorName)}, the bank details your earnings from ${strong(o.gymName)} are paid into have been updated. Every payout from here goes to the account below.`),
      panel([
        ['Bank', bankLine(o.bankName, o.last4)],
        ['Gym', t`${o.gymName}`],
      ], 'Where your money goes'),
      ...(o.payoutSettingsUrl ? [linkLine('Check your payout details', o.payoutSettingsUrl)] : []),
      callout('danger', t`If this wasn’t you, ${link('contact support', o.supportUrl)} now — someone with access to your account could be redirecting your earnings.`),
    ],
  };
}

/** Platform review of a gym’s payout account. A rejection without the reason
 *  just produces a resubmission of the same thing. */
export function payoutAccountReviewed(o: {
  gymName: string;
  approved: boolean;
  bankName?: string | null;
  last4?: string | null;
  /** Why it was rejected — or a note on the approval. Free text, escaped. */
  reason?: string | null;
  payoutSettingsUrl: string;
}): EmailContent {
  const bank = o.bankName && o.last4 ? bankLine(o.bankName, o.last4) : '';
  const reason = (o.reason ?? '').trim();

  if (o.approved) {
    return {
      subject: line(`Your payout account for ${o.gymName} is approved`),
      preheader: 'Member payments now settle straight into it.',
      blocks: [
        h1('Your payout account is approved'),
        p(t`The payout account for ${strong(o.gymName)} passed review. Member payments now settle into it on Paystack’s normal schedule, minus the platform commission.`),
        panel([
          ['Gym', t`${o.gymName}`],
          ['Bank', bank],
          ['Status', 'Approved'],
        ]),
        ...(reason ? [callout('info', t`Note: ${reason}`)] : []),
        button('See your payout settings', o.payoutSettingsUrl),
      ],
    };
  }

  return {
    subject: line(`Your payout account for ${o.gymName} wasn’t approved`),
    preheader: 'Fix the detail below and send it again — payouts are paused until then.',
    blocks: [
      h1('Your payout account wasn’t approved'),
      p(t`The payout account submitted for ${strong(o.gymName)} didn’t pass review, so payouts stay paused until a valid one is in place.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Bank', bank],
        ['Status', 'Not approved'],
      ]),
      callout('warning', reason
        ? t`Why: ${reason}`
        : t`The most common cause is a mismatch between the account name and the registered business name.`),
      button('Submit new payout details', o.payoutSettingsUrl),
    ],
  };
}

// ── Gym ops ──────────────────────────────────────────────────────────────────

/** A member asked to freeze their membership. Goes to staff because the request
 *  sits in 'pause_requested' until a human decides. */
export function freezeRequested(o: {
  gymName: string;
  memberName: string;
  /** Formatted dates of the requested window. */
  startDate: string;
  endDate: string;
  /** The member’s own words. Free text, escaped. */
  reason?: string | null;
  /** Where staff approve or decline it. */
  reviewUrl: string;
}): EmailContent {
  const reason = (o.reason ?? '').trim();
  return {
    subject: line(`${o.memberName} asked to freeze their membership`),
    preheader: line(`${o.startDate} to ${o.endDate}. It waits on your decision.`),
    blocks: [
      h1('A freeze request needs a decision'),
      p(t`${strong(o.memberName)} asked to pause their membership at ${strong(o.gymName)}. Nothing changes on their account until you approve or decline it.`),
      panel([
        ['Member', t`${o.memberName}`],
        ['Freeze from', t`${o.startDate}`],
        ['Resume on', t`${o.endDate}`],
        ['Gym', t`${o.gymName}`],
      ], 'Freeze request'),
      ...(reason ? [callout('info', t`Their reason: ${reason}`)] : []),
      p('Approving credits the paused days back onto their membership when it resumes — a freeze delays the end date, it doesn’t cost them time.'),
      button('Review the request', o.reviewUrl),
    ],
  };
}

/** Platform commission on member payments changed. Contractual, so it states the
 *  old rate, the new rate and the date the switch happens. */
export function commissionChanged(o: {
  gymName: string;
  /** Previous percentage, when there was one. */
  previousPct?: number | null;
  newPct: number;
  /** Formatted date the new rate applies from. */
  effectiveDate: string;
  billingUrl?: string | null;
}): EmailContent {
  return {
    subject: line(`Your GymFlow commission is now ${o.newPct}%`),
    preheader: line(`Effective ${o.effectiveDate} on ${o.gymName}. Payments settled before then keep the old rate.`),
    blocks: [
      h1('Your commission rate is changing'),
      p(t`From ${strong(o.effectiveDate)}, GymFlow keeps ${strong(`${o.newPct}%`)} of each member payment at ${strong(o.gymName)}. The rest settles into your bank as it does today.`),
      panel([
        ['Gym', t`${o.gymName}`],
        ['Was', o.previousPct == null ? '' : t`${o.previousPct}%`],
        ['Now', t`${o.newPct}%`],
        ['Effective', t`${o.effectiveDate}`],
      ], 'Commission'),
      p('Anything that settled before that date keeps the old rate. Your subscription price is separate and hasn’t changed.'),
      ...(o.billingUrl ? [button('See your billing', o.billingUrl)] : []),
      small('Think this is wrong? Reply to this email — a person reads it.'),
    ],
  };
}

// ── Platform admin + support ─────────────────────────────────────────────────

/** Contact-form submission, to GymFlow’s own alert inbox. Built for triage:
 *  who, from where, how urgent, then the message itself. */
export function contactReceived(o: {
  name: string;
  email: string;
  gymName?: string | null;
  topic: string;
  message: string;
  /** support_tickets.priority — 'high' | 'normal' | … */
  priority: string;
  /** Superadmin support page for the ticket. */
  ticketUrl?: string | null;
}): EmailContent {
  // One paragraph per line the sender typed. HTML collapses newlines, so a
  // pasted message would otherwise arrive as one unreadable block — which is
  // exactly the mail someone has to read carefully.
  const lines = o.message.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const body = lines.length ? lines.map((l) => p(t`${l}`)) : [small('(no message)')];

  return {
    subject: line(`${o.topic} · ${o.name}${o.gymName ? ` · ${o.gymName}` : ''}`),
    preheader: line(`${o.priority} priority · reply to ${o.email}`),
    blocks: [
      h1('New message from the contact form'),
      panel([
        ['From', t`${o.name}`],
        ['Email', link(o.email, `mailto:${o.email}`)],
        ['Gym', t`${o.gymName ?? ''}`],
        ['Topic', t`${o.topic}`],
        ['Priority', t`${o.priority}`],
      ]),
      h2('Message'),
      ...body,
      divider(),
      linkLine(`Reply to ${o.name}`, `mailto:${o.email}`),
      ...(o.ticketUrl ? [button('Open the ticket', o.ticketUrl)] : []),
    ],
  };
}

/** Acknowledgement to whoever filled the form. Its only job is to stop them
 *  wondering whether the form worked. */
export function contactAck(o: {
  name?: string | null;
  topic: string;
  /** How long a reply takes, in words — 'one working day'. */
  responseTime: string;
  pricingUrl?: string | null;
}): EmailContent {
  return {
    subject: 'Your message reached GymFlow',
    preheader: line(`A person reads every one of these. Expect a reply within ${o.responseTime}.`),
    blocks: [
      h1('Your message came through'),
      p(t`Hi ${firstName(o.name)}, thanks for writing in about ${strong(o.topic)}. A person reads every message that comes through that form — no bots, no ticket maze.`),
      p(t`Expect a reply within ${strong(o.responseTime)}. If something changes in the meantime, reply to this email and it lands in the same inbox.`),
      ...(o.pricingUrl ? [linkLine('See what GymFlow costs', o.pricingUrl)] : []),
    ],
  };
}

/** A Paystack charge settled for less than the plan costs, to GymFlow’s alert
 *  inbox. Fulfilment already decided what to do with it (see lib/paystack-fulfill)
 *  — this is the human-readable half of that audit trail. */
export function underpaymentAlert(o: {
  /** Paystack transaction reference. */
  reference: string;
  gymName?: string | null;
  /** Who paid, when it’s a member charge. */
  payerName?: string | null;
  expectedNaira: number;
  receivedNaira: number;
  /** One sentence on what the fulfilment code did with it. */
  handled: string;
  /** Deep link to the transaction on Paystack. */
  paystackUrl?: string | null;
}): EmailContent {
  const shortfall = Math.max(0, o.expectedNaira - o.receivedNaira);
  return {
    subject: line(`Underpayment on ${o.reference} · short by ${naira(shortfall).text}`),
    preheader: line(`Expected ${naira(o.expectedNaira).text}, received ${naira(o.receivedNaira).text}.`),
    blocks: [
      h1('A charge came in short'),
      p(t`Paystack settled ${naira(o.receivedNaira)} against a charge that should have been ${naira(o.expectedNaira)} — short by ${naira(shortfall)}.`),
      panel([
        ['Reference', t`${o.reference}`],
        ['Gym', t`${o.gymName ?? ''}`],
        ['Payer', t`${o.payerName ?? ''}`],
        ['Expected', naira(o.expectedNaira)],
        ['Received', naira(o.receivedNaira)],
        ['Short by', naira(shortfall)],
      ], 'Transaction'),
      h2('What was done'),
      p(t`${o.handled}`),
      ...(o.paystackUrl ? [linkLine('Open the transaction on Paystack', o.paystackUrl)] : []),
      small('Refund-window arbitrage looks exactly like this, so check the payer’s recent charges before writing it off.'),
    ],
  };
}
