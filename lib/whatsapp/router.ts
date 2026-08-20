import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtNaira } from '@/lib/format';
import { offersTrainer, trainerAddonPrice } from '@/lib/plan-addon';
import {
  logInbound, logOutbound, markRead,
  sendWhatsAppButtons, sendWhatsAppFlow, sendWhatsAppList, sendWhatsAppText,
  type WhatsAppSendResult,
} from '@/lib/whatsapp/cloud-api';
import {
  contactByWaId, patchState, setActiveGym, setOptIn, unlinkContact, upsertContact,
  activeGymIds, type WhatsAppContact,
} from '@/lib/whatsapp/contacts';
import { createFlowSession } from '@/lib/whatsapp/flow-session';
import { SCREEN } from '@/lib/whatsapp/flow-json';
import { gymById, gymByMemberCode, gymBySlug, gymHomeUrl, loadGymWhatsAppSettings, type WhatsAppGym, type WhatsAppGymSettings } from '@/lib/whatsapp/settings';
import { membershipSnapshot, planOptions, visitState } from '@/lib/whatsapp/membership';
import { parseQrMessage, verifyGymQrToken, whatsappCheckToggle, whatsappCheckinCode } from '@/lib/whatsapp/checkin';
import { startWhatsAppCheckout } from '@/lib/whatsapp/payments';
import { askAssistant } from '@/lib/ai/assistant';
import { isOfflineGym } from '@/lib/gym-status';
import type { IncomingWhatsAppMessage } from '@/lib/whatsapp/inbound';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// The conversation.
//
// SHAPE OF THE DECISION. Everything a member can *do* — check in, get a code,
// start a payment, sign in — is reachable only through a fixed action id
// (`menu:checkin`, `plan:<uuid>`, …) or an exact typed keyword. The AI never
// sits between an intent and an effect; it only answers questions, and only
// when nothing deterministic matched. That is what keeps a channel that talks
// to strangers from being an instruction-following surface for them.
//
// AUTHENTICATION. A contact linked to a profile is authenticated for reads and
// for actions on their own membership. Linking happens either through the Flow
// (email + password) or by their WhatsApp number already being on their profile
// — see contacts.ts for why the latter is an acceptable trust model.

const HELP_WORDS = new Set(['hi', 'hello', 'hey', 'menu', 'start', 'help', 'options', 'good morning', 'good afternoon', 'good evening']);
const STATUS_WORDS = new Set(['status', 'membership', 'days', 'days left', 'balance', 'expiry', 'plan']);
const CHECKIN_WORDS = new Set(['checkin', 'check in', 'check-in', 'in', 'arrived', 'checkout', 'check out', 'check-out', 'out', 'leaving']);
const CODE_WORDS = new Set(['code', 'front desk', 'reception', 'desk code']);
const RENEW_WORDS = new Set(['renew', 'pay', 'payment', 'subscribe', 'package', 'packages', 'price', 'prices', 'plans']);
const SUPPORT_WORDS = new Set(['support', 'human', 'agent', 'contact', 'complaint', 'talk to someone']);
const APP_WORDS = new Set(['app', 'download', 'link', 'dashboard']);
const SITE_WORDS = new Set(['website', 'site', 'web', 'gym website', 'page']);
const ACCOUNT_WORDS = new Set(['account', 'my account', 'profile', 'who am i', 'signout', 'sign out', 'logout', 'log out']);
const SIGNIN_WORDS = new Set(['signin', 'sign in', 'login', 'log in']);
const SIGNUP_WORDS = new Set(['signup', 'sign up', 'register', 'join', 'create account']);
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'opt out', 'optout']);
const START_WORDS = new Set(['start messages', 'resume', 'opt in', 'optin']);

/** Reply plumbing bound to one conversation, so handlers just say what to send. */
type Ctx = {
  admin: Admin;
  msg: IncomingWhatsAppMessage;
  contact: WhatsAppContact;
  gymId: string | null;
  say: (body: string, opts?: { kind?: string; authoredBy?: string }) => Promise<void>;
  buttons: (body: string, btns: { id: string; title: string }[], opts?: { header?: string; footer?: string }) => Promise<void>;
  list: (body: string, rows: { id: string; title: string; description?: string }[], buttonLabel: string, opts?: { header?: string; footer?: string; sectionTitle?: string }) => Promise<void>;
  flow: (screen: string, cta: string, body: string, kind: string, data?: Record<string, unknown>) => Promise<void>;
};

/**
 * Handle one inbound message end to end: recognise the sender, work out what
 * they want, send the reply, log both sides.
 *
 * Never throws. A webhook that rejects makes Meta redeliver the whole batch,
 * which would replay every message in it — including ones already answered.
 */
export async function handleInboundMessage(admin: Admin, msg: IncomingWhatsAppMessage): Promise<void> {
  const contact = await upsertContact(admin, { waId: msg.from, displayName: msg.contactName, inbound: true });
  if (!contact) return;

  if (msg.messageId) void markRead({ phoneNumberId: msg.phoneNumberId, messageId: msg.messageId });

  const { duplicate } = await logInbound(admin, {
    contactId: contact.id,
    gymId: contact.active_gym_id,
    waMessageId: msg.messageId,
    kind: msg.kind,
    body: msg.text,
    payload: msg.actionId ? { actionId: msg.actionId } : msg.flowResponse,
  });

  // ALWAYS returning 200 (see the webhook route) only covers a batch we managed
  // to answer. Meta redelivers anything it did not see acked, and this route
  // does its work synchronously — up to four LLM rounds, a Paystack init,
  // several Graph sends — so a timeout or a crash before the ack brings the
  // same wamid back. Routing it a second time does the action a second time:
  // a redelivered door QR CHECKS THE MEMBER OUT while they are still inside, a
  // redelivered package tap issues a second payment link under a second
  // reference, a redelivered "front desk code" voids the one they are reading
  // out. The inbound row's unique (wa_message_id, direction) index is what
  // settles which delivery is the first one, so the loser stops here.
  //
  // A message Meta sent no id for still routes: an unanswered member is a worse
  // failure than an occasional repeated one. The cost of this direction is that
  // a delivery which logged its row and THEN died is not retried either — at
  // most once, which for actions that move money and doors is the safe side.
  if (duplicate) return;

  // A blocked contact is one a gym has explicitly silenced. Log and stop.
  if (contact.blocked) return;

  const ctx = makeCtx(admin, msg, contact);

  try {
    await route(ctx);
  } catch (e) {
    console.error('[whatsapp/router] failed:', (e as Error).message);
    await ctx.say('Sorry — something went wrong on our side. Please try again in a moment.');
  }
}

function makeCtx(admin: Admin, msg: IncomingWhatsAppMessage, contact: WhatsAppContact): Ctx {
  const to = msg.from;
  const phoneNumberId = msg.phoneNumberId;

  const record = async (result: WhatsAppSendResult, kind: string, body: string | null, authoredBy: string) => {
    if (!result.ok && !result.skipped) console.error(`[whatsapp/router] send failed: ${result.error}`);
    await logOutbound(admin, { contactId: contact.id, gymId: contact.active_gym_id, kind, body, authoredBy, result });
  };

  return {
    admin, msg, contact, gymId: contact.active_gym_id,
    say: async (body, opts) => {
      const res = await sendWhatsAppText({ phoneNumberId, to, body });
      await record(res, opts?.kind ?? 'text', body, opts?.authoredBy ?? 'menu');
    },
    buttons: async (body, btns, opts) => {
      const res = await sendWhatsAppButtons({ phoneNumberId, to, body, buttons: btns, ...opts });
      await record(res, 'buttons', body, 'menu');
    },
    list: async (body, rows, buttonLabel, opts) => {
      const res = await sendWhatsAppList({ phoneNumberId, to, body, rows, buttonLabel, ...opts });
      await record(res, 'list', body, 'menu');
    },
    flow: async (screen, cta, body, kind, data) => {
      const flowId = process.env.WHATSAPP_FLOW_ID;
      if (!flowId) {
        // Without a published Flow there is no secure way to take a password,
        // so say what to do instead of failing silently.
        const res = await sendWhatsAppText({
          phoneNumberId, to,
          body: 'Account sign-in isn’t available on WhatsApp yet. Please use the GymFlow app or ask your gym front desk.',
        });
        await record(res, 'text', null, 'menu');
        return;
      }
      const token = await createFlowSession(admin, {
        waId: msg.from, kind, gymId: contact.active_gym_id, data,
      });
      if (!token) {
        const res = await sendWhatsAppText({ phoneNumberId, to, body: 'Sorry — couldn’t open that form. Please try again.' });
        await record(res, 'text', null, 'menu');
        return;
      }
      const res = await sendWhatsAppFlow({
        phoneNumberId, to, flowId, flowToken: token, ctaLabel: cta, body, screen, data,
      });
      await record(res, 'flow', body, 'menu');
    },
  };
}

// ── Routing ────────────────────────────────────────────────────────────────

async function route(ctx: Ctx): Promise<void> {
  const { admin, msg } = ctx;
  const raw = msg.text.trim();
  const word = raw.toLowerCase();

  // A completed Flow. The endpoint already did the work and linked the account;
  // this is just the moment to show them what they can now do.
  if (msg.kind === 'flow') {
    const fresh = await contactByWaId(admin, msg.from);
    if (fresh?.profile_id && fresh.active_gym_id) {
      const gym = await gymById(admin, fresh.active_gym_id);
      if (gym) return mainMenu({ ...ctx, contact: fresh, gymId: gym.id }, gym, await loadGymWhatsAppSettings(admin, gym), fresh.profile_id);
    }
    return ctx.say('Thanks — that’s saved. Send “menu” to see what you can do.');
  }

  // Door QR. Handled before anything else and without needing a chosen gym,
  // because the QR itself names the gym — a member scanning a sign at reception
  // should not first be asked which gym they are standing in.
  const qr = parseQrMessage(raw);
  if (qr) return handleQrCheckin(ctx, qr.slug, qr.token);

  if (STOP_WORDS.has(word)) {
    await setOptIn(admin, ctx.contact.id, false);
    return ctx.say('Done — we’ve stopped reminders to this number. Send “resume” any time to turn them back on. Service replies still work.');
  }
  if (START_WORDS.has(word)) {
    await setOptIn(admin, ctx.contact.id, true);
    return ctx.say('Reminders are back on for this number.');
  }

  if (msg.kind === 'other') {
    return ctx.say('I can only read text here. Send “menu” to see what I can help with.');
  }

  // A tap on the "which gym?" picker names the gym by code.
  if (msg.actionId?.startsWith('gymcode:')) {
    const picked = await gymByMemberCode(admin, msg.actionId.slice('gymcode:'.length));
    if (picked) {
      await setActiveGym(admin, ctx.contact.id, picked.id);
      ctx.contact.active_gym_id = picked.id;
      ctx.gymId = picked.id;
      const settings = await loadGymWhatsAppSettings(admin, picked);
      return ctx.contact.profile_id
        ? mainMenu(ctx, picked, settings, ctx.contact.profile_id)
        : unauthenticated(ctx, picked, settings, '');
    }
  }

  // Signing in does not need a gym first. Handled ahead of resolveGym because
  // the no-gym welcome offers this button: routing it through resolveGym would
  // fail to match "Sign in" as a gym code and re-send that same welcome forever.
  // signinWithPassword resolves the gym from the account once identity is known.
  //
  // An explicit tap always opens the Flow, even for a contact that already has
  // a profile/gym via phone-number auto-link (see contacts.ts): that link
  // proves nothing by itself, so a member routed here by checkoutReply's
  // verification gate needs this to work, not be swallowed as a no-op because
  // they "already" look linked. Typed "sign in" stays restricted to a
  // genuinely unlinked contact, so it doesn't hijack an ordinary message from
  // someone already verified.
  if (msg.actionId === 'auth:signin'
      || (!ctx.contact.profile_id && !ctx.contact.active_gym_id && SIGNIN_WORDS.has(word))) {
    const activeGym = ctx.contact.active_gym_id ? await gymById(admin, ctx.contact.active_gym_id) : null;
    return ctx.flow(SCREEN.signIn, 'Sign in', `Sign in to ${activeGym?.name ?? 'GymFlow'}.`, 'signin', {
      gym_name: activeGym?.name ?? 'GymFlow', gym_code: activeGym?.member_code ?? '', error: '',
    });
  }
  // Answered before resolveGym on purpose: supportReply needs a gym to name a
  // phone number, and anything that falls through to resolveGym here would
  // reply with the same "what's your gym's code?" message that offered this
  // button — a loop the member cannot get out of.
  if (msg.actionId === 'auth:nocode') {
    return ctx.buttons(
      'No problem. Your gym’s code is a short word or number — for example on:\n\n• the invite message or email your gym sent you\n• the GymFlow poster or QR at reception\n• your membership card\n\nAsk anyone at the front desk and they’ll read it out. Send it here and I’ll take it from there.\n\nIf you already have a GymFlow account, you can sign in instead — I’ll find your gym from your account.',
      [{ id: 'auth:signin', title: 'Sign in' }],
    );
  }

  // Creating an account does need one — the new member has to be attached to a
  // gym, and only they know which.
  if (!ctx.contact.active_gym_id && (msg.actionId === 'auth:signup' || SIGNUP_WORDS.has(word))) {
    return ctx.say('Which gym are you joining? Reply with your gym’s code — it’s on your invite, or ask the front desk for it.');
  }

  // Which gym are we talking about?
  const gym = await resolveGym(ctx, raw);
  if (!gym) return; // resolveGym already replied.

  const settings = await loadGymWhatsAppSettings(admin, gym);
  if (!settings.enabled) {
    return ctx.say(`${gym.name} isn’t using WhatsApp right now. Please contact the front desk.`);
  }
  if (isOfflineGym(gym)) {
    return ctx.say(`${gym.name} isn’t active on GymFlow right now. Please contact the front desk.`);
  }

  const memberId = ctx.contact.profile_id;

  // Not yet linked to an account: the only things on offer are signing in,
  // signing up, and the gym's own contact details.
  if (!memberId) return unauthenticated(ctx, gym, settings, word);

  const action = msg.actionId ?? '';

  if (action === 'menu:status' || STATUS_WORDS.has(word)) return statusReply(ctx, gym, settings, memberId);
  // Typed words land on the same offer as the menu button, so "check in" can't
  // quietly take a different route from the entry of the same name.
  if (action === 'menu:checkin' || CHECKIN_WORDS.has(word)) return checkinReply(ctx, gym, settings, memberId);
  if (action === 'menu:code' || CODE_WORDS.has(word)) return codeReply(ctx, gym, memberId);
  if (action === 'menu:renew' || RENEW_WORDS.has(word)) return plansReply(ctx, gym, memberId);
  if (action === 'menu:app' || APP_WORDS.has(word)) return appReply(ctx, gym, settings);
  if (action === 'menu:site' || SITE_WORDS.has(word)) return siteReply(ctx, gym);
  if (action === 'menu:account' || ACCOUNT_WORDS.has(word)) return accountReply(ctx, gym, memberId);
  if (action === 'auth:signout') return signOutReply(ctx, gym);
  if (action === 'menu:support' || SUPPORT_WORDS.has(word)) return supportReply(ctx, gym, settings);
  // plan:<uuid>            → the package was chosen; ask about the trainer if
  //                           this plan offers one
  // plan:<uuid>:trainer     → with the private-trainer add-on
  // plan:<uuid>:solo        → membership only
  if (action.startsWith('plan:')) {
    const [planId, choice] = action.slice('plan:'.length).split(':');
    if (choice === 'trainer' || choice === 'solo') {
      return checkoutReply(ctx, gym, memberId, planId, choice === 'trainer');
    }
    return trainerReply(ctx, gym, memberId, planId);
  }
  if (action === 'menu:menu' || HELP_WORDS.has(word)) return mainMenu(ctx, gym, settings, memberId);

  // Nothing matched. Try the assistant, then fall back to the menu.
  return freeText(ctx, gym, settings, memberId, raw);
}

/**
 * Work out which gym this conversation is about.
 *
 * Order: an explicit member code they just typed, then the gym already on the
 * contact, then — if they belong to exactly one — that one. More than one and
 * we ask, because guessing would show them the wrong membership.
 */
async function resolveGym(ctx: Ctx, raw: string): Promise<WhatsAppGym | null> {
  const { admin, contact } = ctx;

  if (/^[a-z0-9]{3,12}$/i.test(raw)) {
    const byCode = await gymByMemberCode(admin, raw);
    if (byCode) {
      await setActiveGym(admin, contact.id, byCode.id);
      contact.active_gym_id = byCode.id;
      ctx.gymId = byCode.id;
      return byCode;
    }
  }

  if (contact.active_gym_id) {
    const current = await gymById(admin, contact.active_gym_id);
    if (current) return current;
  }

  if (contact.profile_id) {
    const ids = await activeGymIds(admin, contact.profile_id);
    if (ids.length === 1) {
      await setActiveGym(admin, contact.id, ids[0]);
      contact.active_gym_id = ids[0];
      return gymById(admin, ids[0]);
    }
    if (ids.length > 1) {
      const gyms = (await Promise.all(ids.map((id) => gymById(admin, id)))).filter((g): g is WhatsAppGym => Boolean(g));
      await ctx.list(
        'You’re a member at more than one gym. Which one is this about?',
        gyms.map((g) => ({ id: `gymcode:${g.member_code}`, title: g.name.slice(0, 24), description: `Code ${g.member_code}` })),
        'Choose gym',
      );
      return null;
    }
  }

  // Already linked to an account but belonging to no gym: a gym code is the only
  // thing that helps, and offering "Sign in" to someone already signed in would
  // bounce them straight back here.
  if (contact.profile_id) {
    await ctx.say('You’re signed in, but you’re not a member of any gym yet. Reply with your gym’s code — it’s on your invite, or ask the front desk for it.');
    return null;
  }

  // Nobody we recognise, and no gym named yet. Signing in is offered here and
  // not only after a gym is known: signinWithPassword falls back to the member's
  // own gym when no code is given, so an existing member messaging from a number
  // the gym doesn't have on file can identify themselves without first hunting
  // for their gym code.
  // FIRST CONTACT ASKS FOR THE GYM CODE, and asks for it first.
  //
  // One business number fronts every gym on the platform, so until this number
  // knows which gym it is talking about it cannot show a membership, price a
  // package, or open a door — and "sign in" as the opening move asks a brand-new
  // member for an account they don't have yet. The code is the one thing they
  // are certain to have: it's on their invite and printed at reception.
  //
  // Sign in stays available as a button rather than the headline, because an
  // existing member may well not know their gym's code — signinWithPassword
  // resolves the gym from the account, so they never need it.
  await ctx.buttons(
    'Welcome to GymFlow — I can check you in, show your membership, and help you renew, right here in WhatsApp.\n\n*What’s your gym’s code?* Reply with it to get started. It’s on your invite, on the poster at reception, or the front desk will tell you.\n\nAlready have a GymFlow account? Tap Sign in — same email and password as the app.',
    [
      { id: 'auth:signin', title: 'Sign in' },
      { id: 'auth:nocode', title: 'I don’t have a code' },
    ],
    { header: 'GymFlow' },
  );
  return null;
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function unauthenticated(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings, word: string): Promise<void> {
  const action = ctx.msg.actionId ?? '';

  if (action === 'auth:signin' || SIGNIN_WORDS.has(word)) {
    return ctx.flow(SCREEN.signIn, 'Sign in', `Sign in to ${gym.name}.`, 'signin', {
      gym_name: gym.name, gym_code: gym.member_code, error: '',
    });
  }
  if (action === 'auth:signup' || SIGNUP_WORDS.has(word)) {
    return ctx.flow(SCREEN.signUp, 'Create account', `Join ${gym.name} on GymFlow.`, 'signup', {
      gym_code: gym.member_code, error: '',
    });
  }
  if (action === 'menu:support' || SUPPORT_WORDS.has(word)) return supportReply(ctx, gym, settings);

  await ctx.buttons(
    `I’m ${gym.name}’s AI-powered WhatsApp assistant on GymFlow — I can check you in, show your membership status, help you renew and more.\n\nSign in if you already train here, or create an account if you’re new. The same email and password work in the GymFlow app.`,
    [
      { id: 'auth:signin', title: 'Sign in' },
      { id: 'auth:signup', title: 'Create account' },
      { id: 'menu:support', title: 'Contact gym' },
    ],
    { header: gym.name.slice(0, 60) },
  );
}

async function mainMenu(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings, memberId: string): Promise<void> {
  const snap = await membershipSnapshot(ctx.admin, memberId, gym.id);
  const state = await visitState(ctx.admin, memberId, gym.id);

  const summary = snap.active && snap.daysRemaining !== null
    ? `Your ${snap.planName ?? 'membership'} has ${snap.daysRemaining} day${snap.daysRemaining === 1 ? '' : 's'} left.`
    : snap.endDate
      ? 'Your membership has expired.'
      : 'You don’t have an active membership yet.';

  await ctx.list(
    `I’m your AI-powered GymFlow assistant — check in, renew and check your membership details right here.\n\n${summary}\n\nWhat would you like to do?`,
    [
      // Account first, deliberately. A contact only "recognised" by phone number
      // can read a membership but cannot pay (checkoutReply gates on
      // verified_at), so the way to prove who they are belongs at the top of the
      // menu rather than buried under the actions it unlocks.
      ctx.contact.verified_at
        ? { id: 'menu:account', title: 'My account', description: 'Signed in as — or sign out' }
        : { id: 'menu:account', title: 'Sign in or sign up', description: 'Unlock payments on this number' },
      { id: 'menu:checkin', title: state.insideNow ? 'Check out' : 'Check in', description: state.insideNow ? 'You’re currently checked in' : 'Scan the QR at the door' },
      { id: 'menu:code', title: 'Front desk code', description: 'A 6-digit code to read out' },
      { id: 'menu:status', title: 'My membership', description: 'Days left and expiry date' },
      { id: 'menu:renew', title: 'Renew or pay', description: 'See packages and pay' },
      { id: 'menu:app', title: 'Open the app', description: 'Classes, wallet and more' },
      { id: 'menu:site', title: `${gym.name.slice(0, 16)} online`, description: 'The gym’s own website' },
      { id: 'menu:support', title: 'Contact the gym', description: settings.supportPhone ?? 'Speak to the front desk' },
    ],
    'Open menu',
    { header: gym.name.slice(0, 60), footer: 'Reply “menu” any time' },
  );
}

async function statusReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings, memberId: string): Promise<void> {
  const snap = await membershipSnapshot(ctx.admin, memberId, gym.id);

  if (!snap.endDate) {
    return ctx.buttons(
      `You don’t have a membership at ${gym.name} yet. Pick a package to get started.`,
      [{ id: 'menu:renew', title: 'See packages' }, { id: 'menu:support', title: 'Contact gym' }],
    );
  }

  if (!snap.active) {
    return ctx.buttons(
      `Your ${gym.name} membership expired on ${snap.endDate}.\n\nRenew to start training again.`,
      [{ id: 'menu:renew', title: 'Renew now' }, { id: 'menu:support', title: 'Contact gym' }],
    );
  }

  const days = snap.daysRemaining ?? 0;
  const lines = [
    `${gym.name} — membership active`,
    snap.planName ? `Package: ${snap.planName}` : null,
    `Expires: ${snap.endDate}`,
    `Days left: ${days}`,
    snap.inGracePeriod ? '\nYour last payment didn’t clear, but you can still train until the date above.' : null,
    days <= 7 ? '\nRenewing early adds to your current end date — you don’t lose the days you’ve paid for.' : null,
  ].filter(Boolean);

  await ctx.buttons(lines.join('\n'), [
    { id: 'menu:checkin', title: 'Check in' },
    { id: 'menu:renew', title: 'Renew' },
    { id: 'menu:menu', title: 'Menu' },
  ]);
}

/**
 * The door, offered camera-first.
 *
 * Tapping "Check in" used to check the member in on the spot, from wherever
 * they happened to be — a message is not evidence of standing in the building.
 * Scanning the QR at the entrance is, so that is now the offer, and the link
 * lands on /checkin, which opens the camera on arrival (see
 * app/(member)/checkin/checkin-client.tsx). The printed door QR encodes that
 * same URL with ?via=qr, so one scan checks them in either way.
 *
 * WhatsApp cannot open a camera itself — no message type does that — so "open
 * the camera" is necessarily a link that opens it. The two buttons under it are
 * the honest fallbacks for when it can't: no camera permission, a locked-down
 * browser, or a member whose phone simply won't cooperate at the door.
 */
/**
 * The door. Two ways through it, and neither is "send a message".
 *
 * A WhatsApp message proves someone has a phone, not that they are standing in
 * the building — so this offers the QR at the entrance (a link to /checkin,
 * which opens the camera on arrival) or a 6-digit code read out to a human at
 * reception. Both put a physical act between the member and the door.
 *
 * There is deliberately no in-chat "check in here" button. One existed briefly
 * and it made the other two pointless: anyone could log a visit from bed.
 *
 * The other QR route — scanning the door poster with the phone's own camera,
 * which sends `CHECKIN <slug> <token>` back here — is handled by
 * handleQrCheckin and is equally physical: the token comes off the wall.
 */
async function checkinReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings, memberId: string): Promise<void> {
  const state = await visitState(ctx.admin, memberId, gym.id);
  const verb = state.insideNow ? 'Check out' : 'Check in';

  // A gym that turned QR check-in off has only the front desk. Sending its
  // members to scan a QR it doesn't use would be a dead end.
  if (!settings.qrCheckinEnabled) {
    return ctx.buttons(
      `${verb} at the ${gym.name} front desk.\n\nTap below for a 6-digit code and read it out to reception — they'll ${state.insideNow ? 'check you out' : 'check you in'}.`,
      [{ id: 'menu:code', title: 'Front desk code' }, { id: 'menu:menu', title: 'Menu' }],
    );
  }

  // The gym's own subdomain, not settings.appHomeUrl — that one is overridable
  // to a store listing or a branded link, and this has to reach the page that
  // opens the camera.
  const scanUrl = `${gymHomeUrl(gym)}/checkin`;

  await ctx.buttons(
    `${verb} by scanning the QR at ${gym.name}.\n\nTap to open your camera:\n${scanUrl}\n\nThe camera opens as soon as the page loads — point it at the QR by the door.\n\nNo camera? Get a 6-digit code and read it out at reception instead.`,
    [
      { id: 'menu:code', title: 'Front desk code' },
      { id: 'menu:menu', title: 'Menu' },
    ],
  );
}

async function codeReply(ctx: Ctx, gym: WhatsAppGym, memberId: string): Promise<void> {
  const res = await whatsappCheckinCode(ctx.admin, { gym, memberId });
  if (!res.ok) {
    return ctx.buttons(res.error, [{ id: 'menu:renew', title: 'Renew' }, { id: 'menu:support', title: 'Contact gym' }]);
  }
  const minutes = Math.max(1, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 60_000));
  await ctx.say(
    `Your check-in code is *${res.code}*\n\nRead it out at the front desk. It works once and expires in ${minutes} minutes.\n\nIf you’re already checked in, this code checks you out instead.`,
  );
}

async function plansReply(ctx: Ctx, gym: WhatsAppGym, memberId: string): Promise<void> {
  const plans = await planOptions(ctx.admin, gym.id);
  if (plans.length === 0) {
    return ctx.buttons(
      `${gym.name} hasn’t published any packages yet. Please ask the front desk.`,
      [{ id: 'menu:support', title: 'Contact gym' }],
    );
  }

  const snap = await membershipSnapshot(ctx.admin, memberId, gym.id);
  const intro = snap.active && snap.endDate
    ? `Your membership runs to ${snap.endDate}. Renewing adds to that date.\n\nPick a package:`
    : 'Pick a package to get started:';

  await ctx.list(
    `${intro}`,
    plans.map((p) => ({
      id: `plan:${p.id}`,
      title: p.name,
      description: `${p.priceLabel} · ${p.periodLabel}`,
    })),
    'See packages',
    { header: `${gym.name} packages`, footer: 'Secure payment by Paystack' },
  );
}

/**
 * The private-trainer add-on, offered as its own step.
 *
 * The plan row is what decides whether the add-on exists and what it costs
 * (lib/plan-addon.ts), so a member can only be offered what their gym actually
 * sells. Plans without one skip straight to checkout rather than asking a
 * question with one real answer.
 */
async function trainerReply(ctx: Ctx, gym: WhatsAppGym, memberId: string, planId: string): Promise<void> {
  const plans = await planOptions(ctx.admin, gym.id);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    return ctx.buttons('That package isn’t available any more.', [{ id: 'menu:renew', title: 'See packages' }]);
  }

  const addon = { trainer_addon_enabled: plan.trainerAddonEnabled, trainer_addon_price: plan.trainerAddonPrice };
  if (!offersTrainer(addon)) return checkoutReply(ctx, gym, memberId, planId, false);

  const extra = trainerAddonPrice(addon);
  // A bundled-free trainer is a perk, not a surcharge — say so rather than
  // printing "+₦0" at someone.
  const priceLine = extra > 0
    ? `A private trainer is +${fmtNaira(extra)} on top of the ${plan.priceLabel} package — ${fmtNaira(plan.price + extra)} in total.`
    : `${gym.name} includes a private trainer with this package at no extra cost.`;

  await ctx.buttons(
    `*${plan.name}* — ${plan.priceLabel} · ${plan.periodLabel}\n\n${priceLine}\n\nWould you like a private trainer with this membership?`,
    [
      { id: `plan:${planId}:trainer`, title: extra > 0 ? 'Add trainer' : 'Yes, include it' },
      { id: `plan:${planId}:solo`, title: 'Membership only' },
    ],
  );
}

async function checkoutReply(ctx: Ctx, gym: WhatsAppGym, memberId: string, planId: string, withTrainer = false): Promise<void> {
  // memberId alone only proves this number is on file for a profile — that's
  // enough to read membership status, not enough to spend on it (see
  // contacts.ts). A contact only clears this once it's come through the Flow
  // sign-in/sign-up (linkContact sets verified_at); a phone-number auto-match
  // has to prove itself here before Paystack gets involved.
  if (!ctx.contact.verified_at) {
    return ctx.buttons(
      'For your security, please sign in before paying — the same email and password you use in the GymFlow app.',
      [{ id: 'auth:signin', title: 'Sign in' }, { id: 'menu:support', title: 'Contact gym' }],
    );
  }

  const { data: profile } = await ctx.admin.from('profiles').select('email').eq('id', memberId).maybeSingle();
  const email = (profile as { email: string | null } | null)?.email;
  if (!email) {
    return ctx.say('We need an email address on your account before you can pay. Please ask the front desk to add one.');
  }

  const res = await startWhatsAppCheckout(ctx.admin, {
    gym, contactId: ctx.contact.id, memberId, memberEmail: email, planId, withTrainer,
  });
  if (!res.ok) {
    return ctx.buttons(res.error, [{ id: 'menu:renew', title: 'Try again' }, { id: 'menu:support', title: 'Contact gym' }]);
  }

  // Paying while still inside a paid period is a RENEWAL, and the days stack on
  // the end date instead of starting today (lib/plan-duration.ts#renewalBase).
  // Said before paying, not after: a member who thinks they are buying time that
  // starts now, and finds it starts in three weeks, has been misled by silence.
  const snap = await membershipSnapshot(ctx.admin, memberId, gym.id);
  const stacking = snap.active && snap.endDate
    ? `\n\nThis is a renewal — your membership runs to ${snap.endDate}, and these days are added on top of that date. You don’t lose what you’ve already paid for.`
    : '';
  const trainerLine = withTrainer ? '\nIncludes a private trainer.' : '';

  await ctx.say(
    `*${res.planName}* — ${fmtNaira(res.amountKobo / 100)}${trainerLine}${stacking}\n\nTap to pay securely with Paystack:\n${res.url}\n\nYour membership updates automatically once payment clears, and I’ll message you here to confirm.`,
  );
}

async function appReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings): Promise<void> {
  await ctx.say(
    `Open ${gym.name} on GymFlow:\n${settings.appHomeUrl}\n\nSign in with the same email and password you use here. You can book classes, see your wallet, scan the door QR and manage your membership.`,
  );
}

/**
 * The gym's own website — its branded page, not the member dashboard.
 *
 * Distinct from appReply on purpose: that one sends settings.appHomeUrl, which a
 * gym may point at a store listing or a deep link, and members kept asking for
 * the gym itself. This is always the tenant's own address.
 */
async function siteReply(ctx: Ctx, gym: WhatsAppGym): Promise<void> {
  await ctx.buttons(
    `${gym.name} online:\n${gymHomeUrl(gym)}\n\nOpening hours, classes, packages and how to find them.`,
    [{ id: 'menu:menu', title: 'Menu' }],
  );
}

/**
 * Who this number is signed in as, and the way back out.
 *
 * WhatsApp has no session to close, so "signed in" here means the contact row
 * is bound to a profile — and until now there was no way to see that or undo
 * it. A shared or resold phone number would have kept reading somebody else's
 * membership with no visible sign of whose.
 */
async function accountReply(ctx: Ctx, gym: WhatsAppGym, memberId: string): Promise<void> {
  const { data } = await ctx.admin.from('profiles').select('full_name, email').eq('id', memberId).maybeSingle();
  const profile = data as { full_name: string | null; email: string | null } | null;
  const who = profile?.full_name?.trim() || profile?.email || 'your account';
  // Phone-matched contacts are recognised, not proven — checkoutReply already
  // refuses to spend money on them, so say plainly which footing they are on.
  const proven = Boolean(ctx.contact.verified_at);

  await ctx.buttons(
    [
      `Signed in as *${who}* at ${gym.name}.`,
      profile?.email && profile.email !== who ? `Email: ${profile.email}` : null,
      '',
      proven
        ? 'The same email and password work in the GymFlow app and on the web.'
        : 'This number was matched to your account by phone number. Sign in with your password to unlock payments.',
    ].filter((line) => line !== null).join('\n'),
    proven
      ? [{ id: 'auth:signout', title: 'Sign out' }, { id: 'menu:menu', title: 'Menu' }]
      : [{ id: 'auth:signin', title: 'Sign in' }, { id: 'auth:signout', title: 'Not me' }, { id: 'menu:menu', title: 'Menu' }],
  );
}

/** Detach this number from the account it was bound to. */
async function signOutReply(ctx: Ctx, gym: WhatsAppGym): Promise<void> {
  await unlinkContact(ctx.admin, ctx.contact.id);
  ctx.contact.profile_id = null;
  ctx.contact.verified_at = null;
  await ctx.buttons(
    `Signed out. This number is no longer linked to an account at ${gym.name}.\n\nYour membership itself is untouched — sign back in any time with the same email and password.`,
    [{ id: 'auth:signin', title: 'Sign in' }, { id: 'auth:signup', title: 'Create account' }],
  );
}

async function supportReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings): Promise<void> {
  // The GYM's number, not the platform's — a member asking for help wants the
  // people who can actually open the door for them.
  const phone = settings.supportPhone;
  await ctx.say(
    phone
      ? `Speak to ${gym.name} directly:\n\n📞 ${phone}\n\nThey handle memberships, freezes, refunds and anything at the front desk.`
      : `Please speak to the ${gym.name} front desk — they handle memberships, freezes and refunds. I don’t have a phone number on file for them yet.`,
  );
}

async function handleQrCheckin(ctx: Ctx, slug: string, token: string): Promise<void> {
  const gym = await gymBySlug(ctx.admin, slug);
  if (!gym || !verifyGymQrToken(gym.id, token)) {
    return ctx.say('That check-in code isn’t valid. Please use the QR at your gym, or send “menu”.');
  }

  const settings = await loadGymWhatsAppSettings(ctx.admin, gym);
  if (!settings.qrCheckinEnabled) {
    return ctx.buttons(
      `${gym.name} doesn’t use WhatsApp QR check-in. Get a code for the front desk instead.`,
      [{ id: 'menu:code', title: 'Front desk code' }],
    );
  }

  await setActiveGym(ctx.admin, ctx.contact.id, gym.id);
  ctx.contact.active_gym_id = gym.id;

  if (!ctx.contact.profile_id) {
    await patchState(ctx.admin, ctx.contact, { pending: 'qr_checkin' });
    return ctx.buttons(
      `Welcome to ${gym.name}. Sign in and I’ll check you straight in.`,
      [{ id: 'auth:signin', title: 'Sign in' }, { id: 'auth:signup', title: 'Create account' }],
    );
  }

  const res = await whatsappCheckToggle(ctx.admin, { gym, memberId: ctx.contact.profile_id, method: 'whatsapp_qr' });
  if (!res.ok) {
    return ctx.buttons(res.error, [{ id: 'menu:renew', title: 'Renew' }, { id: 'menu:support', title: 'Contact gym' }]);
  }
  if (res.action === 'checked_out') {
    return ctx.say(`Checked out of ${gym.name}. See you next time.`);
  }
  const tail = res.daysRemaining !== null ? `\n\n${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left.` : '';
  await ctx.say(`Checked in at ${gym.name}. Enjoy your session.${tail}`);
}

/**
 * Anything the scripted routes didn't recognise.
 *
 * The assistant gets first refusal; when it is off, unconfigured, over budget
 * or simply fails, the member gets the menu. They never see an error about the
 * AI — from their side the channel just works, with or without it.
 */
async function freeText(
  ctx: Ctx,
  gym: WhatsAppGym,
  settings: WhatsAppGymSettings,
  memberId: string,
  text: string,
): Promise<void> {
  if (settings.aiEnabled) {
    const { data: profile } = await ctx.admin.from('profiles').select('full_name').eq('id', memberId).maybeSingle();
    const res = await askAssistant(ctx.admin, {
      gym,
      settings,
      memberId,
      memberName: (profile as { full_name: string | null } | null)?.full_name ?? ctx.contact.display_name,
      message: text,
    });
    if (res.ok) {
      await ctx.say(res.text, { kind: 'text', authoredBy: 'ai' });
      return;
    }
  }
  await mainMenu(ctx, gym, settings, memberId);
}
