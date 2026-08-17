import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// What a member is told, and by which channel.
//
// The WhatsApp thread is the surface most GymFlow members actually watch, and
// the gaps this pins were all the same shape: something happened to a member's
// account and the confirmation existed only somewhere they weren't looking —
// on the staff member's screen, in the web dashboard, in an email.
//
// Source-scanning rather than behavioural, in the style of the other call-site
// locks here (test/mobile-api.test.ts, test/gym-status.test.ts): these are
// wiring facts — "this call site calls that function" — and a wiring fact is
// exactly what goes missing when someone adds a fifth check-in path later.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

describe('the door tells the member', () => {
  const src = read('lib/actions/admin-member.ts');

  it('every staff-driven check-in and check-out notifies', () => {
    // Four paths: manual in, manual out, and the front-desk code redeeming as
    // either. A member who reads a code out at reception got nothing at all
    // before this — the confirmation lived only on the staffer's screen.
    const calls = src.match(/deliverDoorEvent\(/g) ?? [];
    expect(calls.length).toBe(4);
    expect(src).toMatch(/action: 'checked_in'/);
    expect(src).toMatch(/action: 'checked_out'/);
  });

  it('the check-in confirmation can quote days left, the check-out one session length', () => {
    expect(src).toContain('daysLeftFor(');
    expect(src).toContain('minutesSince(open.checked_in_at)');
  });

  it('notification failure cannot fail the check-in', () => {
    // The member is already through the door. deliverDoorEvent returns void and
    // swallows its own errors, so no call site can accidentally await it into
    // the staffer's error path.
    const notify = read('lib/notify.ts');
    expect(notify).toMatch(/export function deliverDoorEvent\([\s\S]{0,400}\): void/);
    expect(notify).toContain('catch');
    // And it is never awaited at a call site.
    expect(src).not.toMatch(/await deliverDoorEvent/);
  });

  it('is skipped for a blocked contact but not for one who only muted reminders', () => {
    // "stop" turns off reminders, and the router's reply to it says service
    // replies still work. A receipt for something that just happened at the
    // member's own request is the service half.
    const wa = read('lib/whatsapp/notify.ts');
    const fn = wa.slice(wa.indexOf('export async function notifyDoorEvent'));
    expect(fn).toContain("skipped: 'blocked'");
    expect(fn.slice(0, fn.indexOf('insideWindow'))).not.toContain('opted_in');
  });
});

describe('checking in from WhatsApp', () => {
  const src = read('lib/whatsapp/router.ts');

  it('offers the camera first and the in-chat toggle as the fallback', () => {
    // A WhatsApp message is not evidence of standing in the building; scanning
    // the QR at the door is.
    expect(src).toContain('/checkin`');
    expect(src).toContain("id: 'menu:checkin:now'");
    expect(src).toMatch(/async function checkinNow\(/);
  });

  it('sends members to the gym subdomain, not the overridable app link', () => {
    // settings.appHomeUrl can be pointed at a store listing; the scan link has
    // to reach the page that opens the camera.
    const fn = src.slice(src.indexOf('async function checkinReply'), src.indexOf('async function checkinNow'));
    expect(fn).toContain('gymHomeUrl(gym)');
    // Comments stripped first: the code above this function explains why
    // appHomeUrl is the wrong choice here, and that explanation is not a use.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('appHomeUrl');
  });

  it('skips the scan offer for a gym that turned QR check-in off', () => {
    expect(src).toMatch(/if \(!settings\.qrCheckinEnabled\) return checkinNow/);
  });
});

describe('a first-time contact', () => {
  const src = read('lib/whatsapp/router.ts');

  it('is asked for the gym code before anything else', () => {
    // One number fronts every gym, so until it knows which gym it cannot show a
    // membership, price a package or open a door.
    const welcome = src.slice(src.indexOf('FIRST CONTACT ASKS FOR THE GYM CODE'));
    const body = welcome.slice(0, welcome.indexOf('return null'));
    expect(body).toContain('What’s your gym’s code?');
    // Sign in stays reachable — an existing member may not know the code.
    expect(body).toContain("id: 'auth:signin'");
  });

  it('has a way out when they do not have a code, and it does not loop', () => {
    // 'auth:nocode' must be answered BEFORE resolveGym: anything falling
    // through to resolveGym replies with the message that offered the button.
    const nocodeAt = src.indexOf("msg.actionId === 'auth:nocode'");
    const resolveAt = src.indexOf('const gym = await resolveGym(ctx, raw)');
    expect(nocodeAt).toBeGreaterThan(0);
    expect(nocodeAt).toBeLessThan(resolveAt);
  });

  it('can create an account without leaving WhatsApp', () => {
    expect(src).toContain('SCREEN.signUp');
    expect(src).toContain("'Create account'");
  });
});

describe('subscribing from WhatsApp', () => {
  const src = read('lib/whatsapp/router.ts');

  it('offers the private-trainer add-on when the plan has one', () => {
    expect(src).toMatch(/async function trainerReply\(/);
    expect(src).toContain('plan:${planId}:trainer');
    expect(src).toContain('plan:${planId}:solo');
    // The plan row decides whether the add-on exists — not the member's tap.
    expect(src).toContain('offersTrainer(addon)');
  });

  it('passes the member’s choice through to the checkout', () => {
    expect(src).toMatch(/startWhatsAppCheckout\([\s\S]{0,200}withTrainer/);
  });

  it('says a payment made while still covered is a renewal that stacks', () => {
    const fn = src.slice(src.indexOf('async function checkoutReply'));
    expect(fn).toContain('This is a renewal');
    // And it says so BEFORE the payment link, not after.
    expect(fn.indexOf('This is a renewal')).toBeLessThan(fn.indexOf('Tap to pay securely'));
  });
});

describe('payment confirmations', () => {
  it('reach members who paid on the web or in the app, not only in WhatsApp', () => {
    // This used to return early whenever there was no whatsapp_payment_intent,
    // so renewing anywhere else confirmed nothing on the channel the member
    // actually watches.
    const src = read('lib/whatsapp/notify.ts');
    expect(src).toMatch(/if \(!intent\) \{[\s\S]{0,400}confirmForMember/);
    expect(src).toMatch(/async function confirmForMember/);
  });

  it('are handed the member and gym by the webhook', () => {
    const hook = read('app/api/paystack/webhook/route.ts');
    expect(hook).toMatch(/confirmWhatsAppPayment\([\s\S]{0,400}memberId:/);
    expect(hook).toMatch(/confirmWhatsAppPayment\([\s\S]{0,400}gymId:/);
    // Still gated on `created`, so the webhook and the callback — which fire
    // near-simultaneously — cannot both message the member.
    expect(hook).toMatch(/if \(result\.ok && result\.created\)/);
  });

  it('have a template for the out-of-window case', () => {
    // Meta only allows free text within 24 hours of the member's last message.
    // A staff-driven check-in usually falls outside that.
    const tpl = read('lib/whatsapp/templates.ts');
    expect(tpl).toContain('gymflow_checked_in');
    expect(tpl).toContain('gymflow_checked_out');
  });
});

describe('one account across WhatsApp, the app and the web', () => {
  it('every sign-in path authenticates against Supabase auth with a password', () => {
    for (const file of ['lib/whatsapp/auth.ts', 'app/api/app/signin/route.ts', 'lib/auth/actions.ts']) {
      expect(read(file), `${file} must use signInWithPassword`).toContain('signInWithPassword');
    }
  });

  it('a WhatsApp signup creates an ordinary auth user, not a parallel credential', () => {
    // The whole reason the same email and password work in all three places.
    // A local password column here would be a second source of truth and would
    // drift the first time one side reset a password.
    const src = read('lib/whatsapp/auth.ts');
    expect(src).toContain('admin.auth.admin.createUser');
    expect(src).toMatch(/password: params\.password/);
    expect(src).not.toMatch(/password_hash|bcrypt|scrypt|argon/i);
  });
});
