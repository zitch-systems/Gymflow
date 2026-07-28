import {
  Safe, bullets, button, callout, code, h1, h2, linkLine, naira, p, panel, small, strong, t,
  type Block, type EmailContent,
} from '../layout';

// Gym-branded mail a MEMBER receives — the messages that go out with their
// gym's name in the From line, not GymFlow's.
//
// Every export is a pure function of its arguments returning EmailContent. The
// gym's identity — logo, brand colour, From name, reply-to, the footer contact
// line — is applied by lib/email/send.ts when it renders these blocks through
// the shell. A template never knows which gym it writes for beyond the name it
// was handed, and never decides whether the message may be sent: that gate
// (per-gym toggles + the member's own opt-out) lives in send.ts by design, so a
// new template here cannot quietly bypass it.
//
// Two rules that are easy to break when editing:
//
//  • URLs arrive as absolute strings from the caller (memberAppUrl(gym, path)).
//    A relative href resolves against the mail client's origin, never ours.
//  • Dates arrive already formatted for display (fmtDate in lib/format).
//    Formatting here would bind the copy to the server's time zone — UTC in
//    production, an hour behind the WAT calendar day these dates came from.
//
// The voice is the gym's: second person, sentence case, no emoji, money through
// naira(). See design/README.md → CONTENT FUNDAMENTALS.

/** What every member template needs: whose gym, and who is being written to. */
export type MemberEmail = {
  /** The gym's display name. Always interpolated through `t`/strong(). */
  gymName: string;
  /** First name only — callers use firstName() from lib/format, which falls
   *  back to 'there' so the greeting never reads "Hi ,". */
  firstName: string;
};

/**
 * Resend tag + gating category for each template.
 *
 * Both are arguments to sendGymEmail, and both were previously decided at the
 * call site — which is how "is a failed card critical?" ends up answered two
 * different ways in two webhooks, one of them letting a gym's Settings toggle
 * swallow a message the member must receive. Answered once, here. send.ts still
 * enforces the gate; this only stops callers from mislabelling the request.
 */
export const MEMBER_TEMPLATES = {
  // Critical mail is ungated: account state a member must hear about even when
  // the gym has switched the softer notifications off. Welcome is on this list
  // because for a staff-created member it is the only message they ever get —
  // and it may carry the set-a-password path into an account someone else made
  // for them. The auto-renew trio is here because each one changes a standing
  // mandate to charge their card.
  welcome: { template: 'member_welcome', category: 'critical' },
  paymentFailed: { template: 'member_payment_failed', category: 'critical' },
  autoRenewEnabled: { template: 'member_auto_renew_on', category: 'critical' },
  autoRenewDisabled: { template: 'member_auto_renew_off', category: 'critical' },
  autoRenewEnded: { template: 'member_auto_renew_ended', category: 'critical' },

  // Expiry is the last beat of the renewal sequence, not a state change the gym
  // would expect under "membership updates" — it rides the same toggle as the
  // 7/3/1-day nudges that preceded it.
  renewalReminder: { template: 'member_renewal_reminder', category: 'nudges' },
  membershipExpired: { template: 'member_membership_expired', category: 'nudges' },

  receipt: { template: 'member_receipt', category: 'receipts' },

  membershipPaused: { template: 'member_membership_paused', category: 'updates' },
  membershipResumed: { template: 'member_membership_resumed', category: 'updates' },
  freezeStarted: { template: 'member_freeze_started', category: 'updates' },
  freezeApproved: { template: 'member_freeze_approved', category: 'updates' },
  freezeDenied: { template: 'member_freeze_denied', category: 'updates' },
  freezeResumed: { template: 'member_freeze_resumed', category: 'updates' },

  classBooked: { template: 'member_class_booked', category: 'classes' },
  classWaitlisted: { template: 'member_class_waitlisted', category: 'classes' },
  classPromoted: { template: 'member_class_promoted', category: 'classes' },
  classCancelled: { template: 'member_class_cancelled', category: 'classes' },
  classesToday: { template: 'member_classes_today', category: 'classes' },
} as const;

// ── Shared copy helpers ──────────────────────────────────────────────────────

/** One greeting shape everywhere. A member who gets four of these in a month
 *  should not be able to tell four different people wrote them. */
const greet = (firstName: string): Block => p(t`Hi ${firstName},`);

/** Join the fragments that are actually present with the house middle dot.
 *  Instructor and location are both nullable columns, and a naive join leaves
 *  "6:00 AM ·  · Studio 1" sitting in someone's inbox. */
function dots(...parts: Array<string | number | null | undefined>): Safe {
  const kept = parts
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter(Boolean);
  return kept.reduce<Safe>((acc, part, i) => (i === 0 ? t`${part}` : t`${acc} · ${part}`), new Safe('', ''));
}

const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/** "today" / "tomorrow" / "in 5 days". The reminder cron clamps at 0, so a
 *  negative count means the same thing as zero: today is the last day. */
const endsIn = (days: number): string => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

// ── Welcome ──────────────────────────────────────────────────────────────────

export type WelcomeArgs = MemberEmail & {
  /** Absolute URL of the member dashboard. */
  dashboardUrl: string;
  /** Set when staff created the account and the member has never signed in.
   *  Without it they have no way in, so it replaces the ordinary CTA. */
  setPasswordUrl?: string | null;
  /** The gym's join code (gyms.member_code). Shown so a member installing the
   *  app fresh can find their gym without asking the front desk. */
  memberCode?: string | null;
  planName?: string | null;
  /** Display-formatted membership end date. */
  endDate?: string | null;
};

/**
 * Someone is now a member — either staff added them or they joined themselves.
 *
 * For a managed member (added at the front desk, never touches the app) this is
 * frequently the ONLY email their gym ever sends, so it carries the whole
 * picture on its own rather than pointing at a dashboard they may never open.
 */
export function welcome(a: WelcomeArgs): EmailContent {
  return {
    subject: `Your membership at ${a.gymName} is live`,
    preheader: 'Check in with the QR at the door, book classes, and renew from your phone.',
    blocks: [
      h1(t`Welcome to ${a.gymName}`),
      greet(a.firstName),
      p(t`Your membership at ${strong(a.gymName)} is set up. Here's what it gets you.`),
      bullets([
        t`Check in by scanning the QR code at the entrance.`,
        t`Book a spot in any class on the timetable.`,
        t`See when your membership ends, and every payment on it.`,
        t`Renew from your phone before it runs out.`,
      ]),
      panel([
        ['Plan', t`${a.planName}`],
        ['Membership ends', t`${a.endDate}`],
      ], 'Your membership'),
      ...(a.setPasswordUrl
        ? [
          p(t`${strong(a.gymName)} created this account for you, so set a password before your first sign-in.`),
          button('Set your password', a.setPasswordUrl),
          linkLine('Open your member app', a.dashboardUrl),
        ]
        : [button('Open your member app', a.dashboardUrl)]),
      ...(a.memberCode
        ? [
          h2('Your gym code'),
          p(t`Installing the app fresh? This is the code that finds ${strong(a.gymName)}.`),
          code(a.memberCode),
        ]
        : []),
      small(t`Keep this email — it's the quickest way back to your gym if you change phones.`),
    ],
  };
}

// ── Renewal + money ──────────────────────────────────────────────────────────

export type RenewalReminderArgs = MemberEmail & {
  /** Whole days until the membership ends. 0 (or less) means it ends today. */
  daysLeft: number;
  /** Display-formatted end date. */
  endDate: string;
  /** Absolute URL of the renew flow. */
  renewUrl: string;
  planName?: string | null;
  /** What renewing costs, when the caller knows the plan. */
  amountNaira?: number | null;
};

/** The membership runs out soon — or today. */
export function renewalReminder(a: RenewalReminderArgs): EmailContent {
  const when = endsIn(a.daysLeft);
  return {
    subject: `Your membership at ${a.gymName} ends ${when}`,
    // "Renew before <date>" is nonsense once <date> IS today, which is exactly
    // when this mail matters most.
    preheader: a.daysLeft <= 0
      ? 'Renew today and you keep training without a gap.'
      : `Renew before ${a.endDate} and you keep training without a gap.`,
    blocks: [
      h1(t`Your membership ends ${when}`),
      greet(a.firstName),
      p(t`Your membership at ${strong(a.gymName)} runs to ${strong(a.endDate)}. Renew and it carries straight on — same account, same history, no gap in access.`),
      panel([
        ['Plan', t`${a.planName}`],
        ['Ends', t`${a.endDate}`],
        ['Renewal', a.amountNaira ? naira(a.amountNaira) : ''],
      ], 'Where you stand'),
      ...(a.daysLeft <= 0
        ? [callout('warning', t`Today is your last day. After tonight, check-in and class booking stop until you renew.`)]
        : []),
      button('Renew your membership', a.renewUrl),
      small(t`Already renewed at the front desk? Then you're sorted — ignore this.`),
    ],
  };
}

/** How the money arrived. Covers the payment_method enum in the database plus
 *  the plainer 'transfer' spelling the manual front-desk form uses. */
export type ReceiptMethod = 'card' | 'cash' | 'transfer' | 'bank_transfer' | 'auto_debit';

const METHOD_LABEL: Record<ReceiptMethod, string> = {
  card: 'Card',
  cash: 'Cash',
  transfer: 'Bank transfer',
  bank_transfer: 'Bank transfer',
  // Named apart from a plain card payment deliberately: a member reading a
  // receipt for a charge they didn't consciously trigger needs to see why.
  auto_debit: 'Card · auto-renew',
};

export type ReceiptArgs = MemberEmail & {
  amountNaira: number;
  method: ReceiptMethod;
  /** Paystack reference, or the front-desk receipt number for cash. */
  reference?: string | null;
  /** Display-formatted date the membership now runs to. */
  endDate?: string | null;
  /** Display-formatted payment date. */
  paidOn?: string | null;
  planName?: string | null;
  /** Absolute URL of the member dashboard. */
  dashboardUrl: string;
};

/** Money received. Reads as a receipt: the facts first, no sell. */
export function receipt(a: ReceiptArgs): EmailContent {
  const amount = naira(a.amountNaira);
  return {
    subject: `Payment received · ${amount.text} at ${a.gymName}`,
    preheader: a.endDate
      ? `Your membership now runs to ${a.endDate}. Nothing else to do.`
      : 'Keep this as your receipt. Nothing else to do.',
    blocks: [
      h1('Payment received'),
      greet(a.firstName),
      p(t`${strong(a.gymName)} has received ${amount} for your membership.`),
      panel([
        ['Amount', amount],
        ['Method', METHOD_LABEL[a.method]],
        ['Plan', t`${a.planName}`],
        ['Paid on', t`${a.paidOn}`],
        ['Reference', t`${a.reference}`],
        ['Membership now runs to', t`${a.endDate}`],
      ], 'Receipt'),
      linkLine('See your membership', a.dashboardUrl),
      small(t`This email is your receipt — keep it for your records.`),
    ],
  };
}

export type PaymentFailedArgs = MemberEmail & {
  /** Absolute URL of the page where the card can be replaced. */
  updateCardUrl: string;
  amountNaira?: number | null;
  /** Display-formatted date access currently runs to. */
  endDate?: string | null;
  planName?: string | null;
};

/**
 * The recurring charge was declined.
 *
 * Urgent without being alarming: nothing has been lost yet, Paystack is still
 * retrying, and one action fixes it. Panic here just makes members assume they
 * have already been locked out and stop reading.
 */
export function paymentFailed(a: PaymentFailedArgs): EmailContent {
  return {
    subject: `Your auto-renew payment at ${a.gymName} didn't go through`,
    preheader: 'Paystack keeps retrying for a few days — update your card and it settles itself.',
    blocks: [
      h1('Your card was declined'),
      greet(a.firstName),
      p(t`The card on file for your membership at ${strong(a.gymName)} was declined, so this cycle hasn't been paid yet.`),
      callout('warning', t`Paystack retries the charge for a few days. Update your card before the last attempt and nothing changes — your access carries on as normal.`),
      panel([
        ['Amount', a.amountNaira ? naira(a.amountNaira) : ''],
        ['Plan', t`${a.planName}`],
        ['Access runs to', t`${a.endDate}`],
      ], 'The charge'),
      button('Update your card', a.updateCardUrl),
      small(t`Banks decline for ordinary reasons — an expired card, a daily limit, an online-payment block. Your bank's app usually says which.`),
    ],
  };
}

export type MembershipExpiredArgs = MemberEmail & {
  /** Display-formatted date the membership ended. */
  endDate: string;
  /** Absolute URL of the renew flow. */
  renewUrl: string;
  planName?: string | null;
  amountNaira?: number | null;
};

/** The membership lapsed. What stops working, and the one way back. */
export function membershipExpired(a: MembershipExpiredArgs): EmailContent {
  return {
    subject: `Your membership at ${a.gymName} has expired`,
    preheader: 'Renewing takes a minute, and your check-in works again the moment it clears.',
    blocks: [
      h1('Your membership has expired'),
      greet(a.firstName),
      p(t`Your membership at ${strong(a.gymName)} ended on ${strong(a.endDate)}. Until you renew:`),
      bullets([
        t`Check-in won't go through at the entrance.`,
        t`Class booking is closed to you.`,
      ]),
      p(t`Your account itself is untouched — same profile, same history. Renewing switches everything back on.`),
      panel([
        ['Plan', t`${a.planName}`],
        ['Expired on', t`${a.endDate}`],
        ['To renew', a.amountNaira ? naira(a.amountNaira) : ''],
      ], 'Your last membership'),
      button('Renew your membership', a.renewUrl),
      small(t`Training somewhere else now? No hard feelings — this is the last you'll hear about it.`),
    ],
  };
}

// ── Pause + freeze lifecycle ─────────────────────────────────────────────────
//
// Two related but distinct flows, and the copy has to keep them apart. The
// membershipPaused/membershipResumed pair is the plain administrative hold —
// staff flipped the state, no dated window worth quoting back. The freeze* set
// is the requested-and-approved flow that carries an explicit from → to window
// and credits the frozen days onto the end date when it resumes.

export type MembershipPausedArgs = MemberEmail & {
  /** Absolute URL of the member dashboard. */
  dashboardUrl: string;
  /** Staff-written note. User-controlled — always through `t`. */
  reason?: string | null;
  /** Display-formatted date the pause took effect. */
  pausedOn?: string | null;
};

/** Staff put the membership on hold. */
export function membershipPaused(a: MembershipPausedArgs): EmailContent {
  return {
    subject: `${a.gymName} paused your membership`,
    preheader: 'Your end date is held where it is — paused days are credited back when you return.',
    blocks: [
      h1('Your membership is paused'),
      greet(a.firstName),
      p(t`${strong(a.gymName)} paused your membership. Check-in and class booking are off until it's back on.`),
      p(t`You're not losing the time — the days you spend paused are added to your end date when your membership resumes.`),
      panel([
        ['Paused from', t`${a.pausedOn}`],
        ['Reason', t`${a.reason}`],
      ], 'The pause'),
      linkLine('See your membership', a.dashboardUrl),
      small(t`Think this is a mistake? Reply to this email and the team will sort it.`),
    ],
  };
}

export type MembershipResumedArgs = MemberEmail & {
  /** Absolute URL of the class timetable. */
  classesUrl: string;
  /** Display-formatted end date after the pause was lifted. */
  endDate?: string | null;
};

/** Staff switched the membership back on. */
export function membershipResumed(a: MembershipResumedArgs): EmailContent {
  return {
    subject: `Your membership at ${a.gymName} is active again`,
    preheader: 'Check-in and class booking work from right now.',
    blocks: [
      h1('Your membership is back on'),
      greet(a.firstName),
      p(t`${strong(a.gymName)} reactivated your membership. Check in and book classes as normal from now.`),
      panel([
        ['Status', 'Active'],
        ['Membership ends', t`${a.endDate}`],
      ], 'Where you stand'),
      button('Book your next class', a.classesUrl),
    ],
  };
}

export type FreezeArgs = MemberEmail & {
  /** Display-formatted first day of the freeze. */
  freezeStart: string;
  /** Display-formatted day the membership comes back. */
  freezeEnd: string;
  /** Absolute URL of the member dashboard. */
  dashboardUrl: string;
  /** Staff-written note. User-controlled — always through `t`. */
  reason?: string | null;
};

/** Staff froze the membership directly, without the member asking. */
export function freezeStarted(a: FreezeArgs): EmailContent {
  return {
    subject: `Your membership at ${a.gymName} is frozen until ${a.freezeEnd}`,
    preheader: 'Frozen days are added back to your end date, so you keep the time you paid for.',
    blocks: [
      h1('Your membership is frozen'),
      greet(a.firstName),
      p(t`${strong(a.gymName)} put your membership on hold. Check-in and class booking are off while it's frozen.`),
      ...freezeWindow(a),
      button('See your membership', a.dashboardUrl),
    ],
  };
}

/** The freeze the member asked for was approved. */
export function freezeApproved(a: FreezeArgs): EmailContent {
  return {
    subject: `${a.gymName} approved your freeze`,
    preheader: `You're on hold from ${a.freezeStart}, and the frozen days come back onto your end date.`,
    blocks: [
      h1('Your freeze is approved'),
      greet(a.firstName),
      p(t`${strong(a.gymName)} approved the freeze you asked for. From ${strong(a.freezeStart)} your check-in and class booking pause, and both come back on ${strong(a.freezeEnd)}.`),
      ...freezeWindow(a),
      button('See your membership', a.dashboardUrl),
    ],
  };
}

/** Facts shared by both ways a freeze starts. */
function freezeWindow(a: FreezeArgs): Block[] {
  return [
    panel([
      ['Frozen from', t`${a.freezeStart}`],
      ['Back on', t`${a.freezeEnd}`],
      ['Reason', t`${a.reason}`],
    ], 'Your freeze'),
    p(t`Every frozen day gets added to your end date when you resume, so you don't pay for time you couldn't train.`),
  ];
}

export type FreezeDeniedArgs = MemberEmail & {
  /** Absolute URL of the member dashboard. */
  dashboardUrl: string;
  /** Staff-written note. User-controlled — always through `t`. */
  reason?: string | null;
  /** Display-formatted end date, unchanged by the refusal. */
  endDate?: string | null;
};

/** The freeze request was turned down. Say so once, plainly, then reassure. */
export function freezeDenied(a: FreezeDeniedArgs): EmailContent {
  return {
    subject: `${a.gymName} didn't approve your freeze request`,
    preheader: 'Your membership stays active and your end date is exactly where it was.',
    blocks: [
      h1(`Your freeze request wasn't approved`),
      greet(a.firstName),
      p(t`${strong(a.gymName)} reviewed the freeze you asked for and turned it down. Nothing on your membership has changed — it stays active and your end date is where it was.`),
      panel([
        ['Reason', t`${a.reason}`],
        ['Membership ends', t`${a.endDate}`],
      ], 'Where you stand'),
      p(t`If the timing matters, reply to this email and talk it through with the team.`),
      linkLine('See your membership', a.dashboardUrl),
    ],
  };
}

export type FreezeResumedArgs = MemberEmail & {
  /** Whole days credited back onto the end date. */
  daysCredited: number;
  /** Display-formatted end date after the credit. */
  newEndDate: string;
  /** Absolute URL of the class timetable. */
  classesUrl: string;
};

/** The freeze is over, and the frozen days have been paid back. */
export function freezeResumed(a: FreezeResumedArgs): EmailContent {
  const credited = a.daysCredited > 0;
  return {
    subject: credited
      ? `Your membership at ${a.gymName} is unfrozen · ${dayCount(a.daysCredited)} added`
      : `Your membership at ${a.gymName} is unfrozen`,
    preheader: `Check-in and class booking work again, and you're now covered to ${a.newEndDate}.`,
    blocks: [
      h1('Your membership is back on'),
      greet(a.firstName),
      p(credited
        ? t`${strong(a.gymName)} unfroze your membership and added the frozen days back. Check in and book classes as normal.`
        : t`${strong(a.gymName)} unfroze your membership. Check in and book classes as normal.`),
      panel([
        ['Days credited', credited ? dayCount(a.daysCredited) : ''],
        ['Membership now ends', t`${a.newEndDate}`],
      ], 'What changed'),
      button('Book your next class', a.classesUrl),
    ],
  };
}

// ── Classes ──────────────────────────────────────────────────────────────────

/** A class as a member reads it. Times and dates are display strings; both
 *  instructor and location are nullable columns, so both are optional. */
export type ClassFacts = {
  className: string;
  /** Display start time, e.g. "6:00 AM". */
  time: string;
  instructor?: string | null;
  location?: string | null;
};

/** A class on a specific day. */
export type DatedClass = ClassFacts & {
  /** Display date of the occurrence, e.g. "Mon, 4 Aug". */
  date: string;
};

function classPanel(c: DatedClass, title: string, extra: Array<[string, Safe | string]> = []): Block {
  return panel([
    ['Class', t`${c.className}`],
    ['When', dots(c.date, c.time)],
    ['Instructor', t`${c.instructor}`],
    ['Where', t`${c.location}`],
    ...extra,
  ], title);
}

export type ClassBookedArgs = MemberEmail & DatedClass & {
  /** Absolute URL of the class page. */
  classUrl: string;
};

/** A spot is held. */
export function classBooked(a: ClassBookedArgs): EmailContent {
  return {
    subject: `You're booked into ${a.className} · ${a.date}`,
    preheader: `${dots(a.time, a.instructor, a.location).text}. Check in at the entrance when you arrive.`,
    blocks: [
      h1(t`You're in for ${a.className}`),
      greet(a.firstName),
      p(t`Your spot at ${strong(a.gymName)} is held. Turn up a few minutes early and check in at the entrance.`),
      classPanel(a, 'Your booking'),
      button('See the class', a.classUrl),
      small(t`Can't make it? Cancel from the app so someone on the waitlist can take the spot.`),
    ],
  };
}

export type ClassWaitlistedArgs = MemberEmail & DatedClass & {
  /** Place in the queue, when the caller counted it. */
  position?: number | null;
  /** Absolute URL of the class page. */
  classUrl: string;
};

/** The class was full, so they are queued instead. */
export function classWaitlisted(a: ClassWaitlistedArgs): EmailContent {
  const place = a.position && a.position > 0 ? ` at number ${a.position}` : '';
  return {
    subject: `You're on the waitlist for ${a.className} · ${a.date}`,
    preheader: `${a.gymName} emails you the moment a spot opens. Nothing to do until then.`,
    blocks: [
      h1(`You're on the waitlist`),
      greet(a.firstName),
      p(t`${strong(a.className)} on ${strong(a.date)} is full, so you're on the waitlist${place}.`),
      classPanel(a, 'The class', a.position && a.position > 0 ? [['Waitlist place', String(a.position)]] : []),
      p(t`When someone cancels, the longest-waiting member takes the spot and gets an email straight away. You don't need to keep checking.`),
      linkLine('See the class', a.classUrl),
    ],
  };
}

export type ClassPromotedArgs = MemberEmail & DatedClass & {
  /** Absolute URL of the class page. */
  classUrl: string;
};

/**
 * A spot opened and the waitlist place became a real booking.
 *
 * Time-critical in a way the other class mail is not: the member last heard
 * "you're on the waitlist" and has probably made other plans, so the fact that
 * they are now expected has to land in the first line.
 */
export function classPromoted(a: ClassPromotedArgs): EmailContent {
  return {
    subject: `A spot opened · you're booked into ${a.className}`,
    preheader: `${a.date} at ${a.time}. Your waitlist place is now a confirmed booking.`,
    blocks: [
      h1(`A spot opened, and it's yours`),
      greet(a.firstName),
      p(t`Someone cancelled, so your waitlist place for ${strong(a.className)} at ${strong(a.gymName)} is now a real booking. You're expected.`),
      callout('success', t`You're confirmed for ${a.className} on ${a.date} at ${a.time}.`),
      classPanel(a, 'Your booking'),
      button('See the class', a.classUrl),
      small(t`If you can no longer make it, cancel now so the next person on the waitlist gets the spot.`),
    ],
  };
}

export type ClassCancelledArgs = MemberEmail & DatedClass & {
  /** Staff-written note. User-controlled — always through `t`. */
  reason?: string | null;
  /** Absolute URL of the class timetable. */
  classesUrl: string;
};

/** The gym called off a class this member had booked. */
export function classCancelled(a: ClassCancelledArgs): EmailContent {
  return {
    subject: `${a.className} on ${a.date} is cancelled`,
    preheader: 'Your booking is released — nothing to cancel on your side.',
    blocks: [
      h1(t`${a.className} is cancelled`),
      greet(a.firstName),
      // One apology, in the gym's own voice, and then straight to what it means
      // for them. Repeating it reads as a script rather than a person.
      p(t`Sorry — ${strong(a.gymName)} has cancelled ${strong(a.className)} on ${strong(a.date)}. Your booking is released, so there's nothing to do on your side.`),
      classPanel(a, 'The cancelled class', a.reason ? [['Reason', t`${a.reason}`]] : []),
      p(t`The rest of the timetable is running as normal.`),
      button('Find another class', a.classesUrl),
    ],
  };
}

export type ClassesTodayArgs = MemberEmail & {
  /** Everything they have booked today, in start-time order. The caller must
   *  not send this with an empty list — a digest of nothing is worse than
   *  silence, and templates don't get to decide not to send. */
  classes: ClassFacts[];
  /** Absolute URL of the class timetable. */
  classesUrl: string;
};

/** Morning digest: what this member has booked today. */
export function classesToday(a: ClassesTodayArgs): EmailContent {
  const list = a.classes;
  const first = list[0];
  const many = list.length > 1;
  return {
    subject: many || !first
      ? `${list.length} classes booked today at ${a.gymName}`
      : `${first.className} today at ${first.time}`,
    preheader: many && first
      ? `First up ${first.time} · ${first.className}. Check in at the entrance when you arrive.`
      : `Booked at ${a.gymName}. Check in at the entrance when you arrive.`,
    blocks: [
      h1(many ? 'Your classes today' : 'Your class today'),
      greet(a.firstName),
      p(many
        ? t`You're booked into ${list.length} classes at ${strong(a.gymName)} today.`
        : t`You're booked in at ${strong(a.gymName)} today.`),
      // Keyed on start time so the day reads top-to-bottom as a schedule.
      panel(list.map((c) => [c.time, dots(c.className, c.instructor, c.location)] as [string, Safe]), 'Today'),
      button('See your bookings', a.classesUrl),
      small(t`Can't make one of these? Cancel from the app so someone on the waitlist can take the spot.`),
    ],
  };
}

// ── Recurring billing ────────────────────────────────────────────────────────

export type AutoRenewEnabledArgs = MemberEmail & {
  amountNaira: number;
  /** Display-formatted date of the next automatic charge. */
  nextChargeDate: string;
  /** Absolute URL of the profile page where auto-renew is switched off. */
  manageUrl: string;
  planName?: string | null;
  /** How often it charges, e.g. "Every month". */
  intervalLabel?: string | null;
};

/** Recurring billing is now on. Amount, when, and how to stop it. */
export function autoRenewEnabled(a: AutoRenewEnabledArgs): EmailContent {
  const amount = naira(a.amountNaira);
  return {
    subject: `Auto-renew is on for your ${a.gymName} membership`,
    preheader: `${amount.text} next on ${a.nextChargeDate}. You can switch it off any time.`,
    blocks: [
      h1('Auto-renew is on'),
      greet(a.firstName),
      p(t`Your membership at ${strong(a.gymName)} now renews itself. Your card is charged automatically, so your access never lapses between payments.`),
      panel([
        ['Plan', t`${a.planName}`],
        ['Amount', amount],
        ['How often', t`${a.intervalLabel}`],
        ['Next charge', t`${a.nextChargeDate}`],
      ], 'Recurring billing'),
      p(t`Switching it off is one tap in your profile. Access still runs to the end of the period you've already paid for.`),
      button('Manage auto-renew', a.manageUrl),
    ],
  };
}

export type AutoRenewDisabledArgs = MemberEmail & {
  /** True when staff turned it off, false when the member did it themselves.
   *  A member who pressed the button needs a confirmation; a member who didn't
   *  needs a notice, because the first they'll otherwise know is a missed
   *  charge and a lapsed membership. */
  byStaff: boolean;
  /** Display-formatted date the paid-for access runs to. */
  endDate?: string | null;
  /** Absolute URL of the renew flow. */
  renewUrl: string;
  planName?: string | null;
};

/** Recurring billing is off — confirmation or notice depending on who did it. */
export function autoRenewDisabled(a: AutoRenewDisabledArgs): EmailContent {
  return {
    subject: a.byStaff
      ? `${a.gymName} switched off your recurring billing`
      : `Auto-renew is off for your ${a.gymName} membership`,
    preheader: a.endDate
      ? `No more automatic charges. Your access runs to ${a.endDate}, then it's a manual renewal.`
      : 'No more automatic charges. Renewing is manual from here.',
    blocks: [
      h1(a.byStaff ? 'Your recurring billing is off' : 'Auto-renew is off'),
      greet(a.firstName),
      p(a.byStaff
        ? t`${strong(a.gymName)} switched off auto-renew on your membership. Nothing was charged, and the access you've already paid for is untouched.`
        : t`Done — your membership at ${strong(a.gymName)} won't charge your card again.`),
      panel([
        ['Plan', t`${a.planName}`],
        ['Access runs to', t`${a.endDate}`],
        ['Next charge', 'None'],
      ], 'Where you stand'),
      ...(a.endDate
        ? [callout('info', t`Nothing renews on ${a.endDate} any more. Renew before then, or switch auto-renew back on, and your access carries straight through.`)]
        : []),
      button('Renew your membership', a.renewUrl),
      ...(a.byStaff ? [small(t`Didn't expect this? Reply to this email and ask the team why.`)] : []),
    ],
  };
}

export type AutoRenewEndedArgs = MemberEmail & {
  /** Display-formatted date the access ran to. */
  endDate: string;
  /** Absolute URL of the renew flow. */
  renewUrl: string;
  planName?: string | null;
};

/** The recurring subscription reached its end and lapsed. */
export function autoRenewEnded(a: AutoRenewEndedArgs): EmailContent {
  return {
    subject: `Your recurring membership at ${a.gymName} has ended`,
    preheader: `The subscription has run its course. Start a new one whenever you're ready.`,
    blocks: [
      h1('Your recurring membership has ended'),
      greet(a.firstName),
      p(t`The auto-renewing subscription on your membership at ${strong(a.gymName)} has come to an end, so your card won't be charged again. Your access ran to ${strong(a.endDate)}.`),
      panel([
        ['Plan', t`${a.planName}`],
        ['Access ran to', t`${a.endDate}`],
        ['Next charge', 'None'],
      ], 'What ended'),
      p(t`Starting again is a fresh membership — pick a plan and you're back in, with auto-renew on or off as you like.`),
      button('Start a new membership', a.renewUrl),
    ],
  };
}
