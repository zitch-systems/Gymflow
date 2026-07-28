// Templates (lib/email/templates/*) compose only from the escaping-safe block
// vocabulary in lib/email/layout. This suite renders a representative template
// from every block family — panel, code, callout, bullets, button, mailto link,
// list-of-rows — through the SAME renderEmail() path the senders use, driving
// each with a hostile gym name / member name / staff-typed message, and asserts
// that nothing user-controlled reaches the HTML unescaped and that the
// plain-text twin is always populated.
//
// The point isn't to re-test escaping (email-layout.test.ts owns that at the
// primitive level) — it's to catch the one way a template can still be wrong:
// bypassing the helpers with raw string concatenation. A template that did that
// would leak the raw <script> marker here.

import { describe, expect, it } from 'vitest';
import { gymBrand, platformBrand } from '@/lib/email/brand';
import { renderEmail, type EmailContent } from '@/lib/email/layout';
import * as member from '@/lib/email/templates/member';
import * as platform from '@/lib/email/templates/platform';

// A gym whose every text field is an injection attempt, plus a benign-but-real
// brand colour and https logo so the branded path is exercised too.
const HOSTILE_GYM = {
  id: 'g1',
  name: 'Iron <script>alert(1)</script> "Republic" & Co',
  slug: 'iron-republic',
  email: 'hi@ironrepublic.ng',
  phone: '+2348012345678',
  city: 'Lagos',
  state: 'Lagos',
  address: '12 Awolowo Rd',
  logo_url: 'https://cdn.example.com/logo.png',
  brand_color: '#c6f24e',
  subscription_plan: 'growth',
};
const XSS = '<script>alert(1)</script>';
const HOSTILE_NAME = `Ade "><img src=x onerror=alert(1)> Bello`;

/** Render a template's content the way a sender would, then assert the output
 *  never carries an executable marker and always has a text twin. */
function assertSafe(content: EmailContent, brand: ReturnType<typeof gymBrand>) {
  const { html, text } = renderEmail({
    brand,
    title: content.subject,
    preheader: content.preheader,
    blocks: content.blocks,
    preferencesUrl: null,
  });

  // Subject/preheader are header values — a newline folds the header.
  expect(content.subject.length).toBeGreaterThan(0);
  expect(content.subject).not.toMatch(/[\r\n]/);
  expect(content.preheader.length).toBeGreaterThan(0);

  // No user-injected markup ever forms a real tag in the HTML. What makes the
  // payload dangerous is the raw `<` that opens a tag; escaping turns it into
  // `&lt;`, so a literal `<script` or a live `<img ... onerror>` can only appear
  // if a template bypassed the helpers. (The layout's own legitimate <img> logo
  // tags carry no onerror, so the second check doesn't flag them.)
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img[^>]*onerror/i);
  // …and the hostile string's escaped form is present, proving it was escaped
  // rather than silently dropped.
  expect(html).toContain('&lt;script&gt;');

  // The text twin is a real, populated alternative — a blank text part is a spam
  // signal. It may contain raw angle brackets as literal characters; that's
  // correct (a text/plain part is never HTML-parsed, so nothing executes).
  expect(text.trim().length).toBeGreaterThan(20);
}

const gymB = gymBrand(HOSTILE_GYM);
const platB = platformBrand();

describe('member templates render safely through the branded pipeline', () => {
  const base = { gymName: HOSTILE_GYM.name, firstName: HOSTILE_NAME };

  const cases: Array<[string, EmailContent]> = [
    ['welcome (bullets + button + code)', member.welcome({
      ...base, dashboardUrl: 'https://iron-republic.gymflow.ng/dashboard',
      setPasswordUrl: 'https://iron-republic.gymflow.ng/reset-password',
      memberCode: 'IRON-42', planName: XSS, endDate: '4 Aug 2026',
    })],
    ['receipt (panel + money)', member.receipt({
      ...base, amountNaira: 13999, method: 'transfer', reference: XSS,
      endDate: '4 Sep 2026', paidOn: '4 Aug 2026', planName: 'Monthly',
      dashboardUrl: 'https://iron-republic.gymflow.ng/dashboard',
    })],
    ['paymentFailed (critical callout)', member.paymentFailed({
      ...base, updateCardUrl: 'https://iron-republic.gymflow.ng/dashboard/renew',
      amountNaira: 13999, endDate: '4 Aug 2026', planName: 'Monthly',
    })],
    ['classBooked (class panel)', member.classBooked({
      ...base, className: XSS, date: 'Mon, 4 Aug', time: '6:00 AM',
      instructor: HOSTILE_NAME, location: 'Studio 1',
      classUrl: 'https://iron-republic.gymflow.ng/classes/1',
    })],
    ['classesToday (list-of-rows panel)', member.classesToday({
      ...base,
      classes: [
        { className: XSS, time: '6:00 AM', instructor: HOSTILE_NAME, location: 'Studio 1' },
        { className: 'Spin', time: '7:30 AM', instructor: null, location: null },
      ],
      classesUrl: 'https://iron-republic.gymflow.ng/classes',
    })],
    ['freezeResumed (updates)', member.freezeResumed({
      ...base, daysCredited: 12, newEndDate: '20 Sep 2026',
      classesUrl: 'https://iron-republic.gymflow.ng/classes',
    })],
  ];

  for (const [name, content] of cases) {
    it(name, () => assertSafe(content, gymB));
  }
});

describe('platform templates render safely', () => {
  const cases: Array<[string, EmailContent]> = [
    ['ownerGymProvisioned (code + warning callout)', platform.ownerGymProvisioned({
      ownerName: HOSTILE_NAME, gymName: HOSTILE_GYM.name, email: 'owner@ironrepublic.ng',
      tempPassword: 'Tmp-9x!qLZ2v', signInUrl: 'https://gymflow.ng/login',
      gymUrl: 'https://iron-republic.gymflow.ng',
    })],
    ['subscriptionReceipt (panel + money)', platform.subscriptionReceipt({
      gymName: HOSTILE_GYM.name, amountNaira: 37999, tier: XSS, paidDate: '4 Aug 2026',
      periodEnd: '4 Sep 2026', reference: 'PSK_123', billingUrl: 'https://gymflow.ng/billing',
    })],
    ['payoutAccountChanged (danger callout + mailto)', platform.payoutAccountChanged({
      gymName: HOSTILE_GYM.name, action: 'activated', bankName: XSS, last4: '4321',
      actorName: HOSTILE_NAME, changedAt: '4 Aug 2026, 2:14pm',
      supportUrl: 'mailto:support@gymflow.ng',
      payoutSettingsUrl: 'https://gymflow.ng/admin/settings',
    })],
    ['contactReceived (mailto link + multi-line message)', platform.contactReceived({
      name: HOSTILE_NAME, email: 'lead@example.com', gymName: HOSTILE_GYM.name,
      topic: 'Booking a demo', message: `Line one ${XSS}\nLine two`, priority: 'high',
      ticketUrl: 'https://gymflow.ng/superadmin/support',
    })],
  ];

  for (const [name, content] of cases) {
    it(name, () => assertSafe(content, platB));
  }
});
