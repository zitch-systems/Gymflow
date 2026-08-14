import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtNaira } from '@/lib/format';
import {
  logInbound, logOutbound, markRead,
  sendWhatsAppButtons, sendWhatsAppFlow, sendWhatsAppList, sendWhatsAppText,
  type WhatsAppSendResult,
} from '@/lib/whatsapp/cloud-api';
import {
  contactByWaId, patchState, setActiveGym, setOptIn, upsertContact,
  activeGymIds, type WhatsAppContact,
} from '@/lib/whatsapp/contacts';
import { createFlowSession } from '@/lib/whatsapp/flow-session';
import { SCREEN } from '@/lib/whatsapp/flow-json';
import { gymById, gymByMemberCode, gymBySlug, loadGymWhatsAppSettings, type WhatsAppGym, type WhatsAppGymSettings } from '@/lib/whatsapp/settings';
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
const APP_WORDS = new Set(['app', 'download', 'link', 'website', 'dashboard']);
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

  await logInbound(admin, {
    contactId: contact.id,
    gymId: contact.active_gym_id,
    waMessageId: msg.messageId,
    kind: msg.kind,
    body: msg.text,
    payload: msg.actionId ? { actionId: msg.actionId } : msg.flowResponse,
  });

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
  if (!ctx.contact.profile_id && !ctx.contact.active_gym_id
      && (msg.actionId === 'auth:signin' || SIGNIN_WORDS.has(word))) {
    return ctx.flow(SCREEN.signIn, 'Sign in', 'Sign in to GymFlow.', 'signin', {
      gym_name: 'GymFlow', gym_code: '', error: '',
    });
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
  if (action === 'menu:checkin' || CHECKIN_WORDS.has(word)) return checkinReply(ctx, gym, settings, memberId);
  if (action === 'menu:code' || CODE_WORDS.has(word)) return codeReply(ctx, gym, memberId);
  if (action === 'menu:renew' || RENEW_WORDS.has(word)) return plansReply(ctx, gym, memberId);
  if (action === 'menu:app' || APP_WORDS.has(word)) return appReply(ctx, gym, settings);
  if (action === 'menu:support' || SUPPORT_WORDS.has(word)) return supportReply(ctx, gym, settings);
  if (action.startsWith('plan:')) return checkoutReply(ctx, gym, memberId, action.slice('plan:'.length));
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
  await ctx.buttons(
    'Welcome to GymFlow.\n\nIf you already have an account, sign in — the same email and password you use in the GymFlow app work here. Otherwise reply with your gym’s code (it’s on your invite, or ask the front desk) to create one.',
    [
      { id: 'auth:signin', title: 'Sign in' },
      { id: 'auth:signup', title: 'Create account' },
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
    `Welcome to ${gym.name} on GymFlow.\n\nSign in to check in, see your remaining days and renew — or create an account if you're new. The same email and password work in the GymFlow app.`,
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
    `${gym.name}\n\n${summary}\n\nWhat would you like to do?`,
    [
      { id: 'menu:checkin', title: state.insideNow ? 'Check out' : 'Check in', description: state.insideNow ? 'You’re currently checked in' : 'Log your visit' },
      { id: 'menu:code', title: 'Front desk code', description: 'A 6-digit code to read out' },
      { id: 'menu:status', title: 'My membership', description: 'Days left and expiry date' },
      { id: 'menu:renew', title: 'Renew or pay', description: 'See packages and pay' },
      { id: 'menu:app', title: 'Open the app', description: 'Classes, wallet and more' },
      { id: 'menu:support', title: 'Contact the gym', description: settings.supportPhone ?? 'Speak to the front desk' },
    ],
    'Open menu',
    { header: 'GymFlow', footer: 'Reply “menu” any time' },
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

async function checkinReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings, memberId: string): Promise<void> {
  const res = await whatsappCheckToggle(ctx.admin, { gym, memberId, method: 'whatsapp' });

  if (!res.ok) {
    return ctx.buttons(res.error, [{ id: 'menu:renew', title: 'Renew' }, { id: 'menu:support', title: 'Contact gym' }]);
  }

  if (res.action === 'checked_out') {
    return ctx.buttons(`Checked out of ${gym.name}. See you next time.`, [{ id: 'menu:menu', title: 'Menu' }]);
  }

  const days = res.daysRemaining;
  const tail = days !== null ? `\n\n${days} day${days === 1 ? '' : 's'} left on your membership.` : '';
  await ctx.buttons(
    `Checked in at ${gym.name}. Enjoy your session.${tail}`,
    [{ id: 'menu:checkin', title: 'Check out' }, { id: 'menu:menu', title: 'Menu' }],
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

async function checkoutReply(ctx: Ctx, gym: WhatsAppGym, memberId: string, planId: string): Promise<void> {
  const { data: profile } = await ctx.admin.from('profiles').select('email').eq('id', memberId).maybeSingle();
  const email = (profile as { email: string | null } | null)?.email;
  if (!email) {
    return ctx.say('We need an email address on your account before you can pay. Please ask the front desk to add one.');
  }

  const res = await startWhatsAppCheckout(ctx.admin, {
    gym, contactId: ctx.contact.id, memberId, memberEmail: email, planId,
  });
  if (!res.ok) {
    return ctx.buttons(res.error, [{ id: 'menu:renew', title: 'Try again' }, { id: 'menu:support', title: 'Contact gym' }]);
  }

  await ctx.say(
    `*${res.planName}* — ${fmtNaira(res.amountKobo / 100)}\n\nTap to pay securely with Paystack:\n${res.url}\n\nYour membership updates automatically once payment clears, and I’ll message you here to confirm.`,
  );
}

async function appReply(ctx: Ctx, gym: WhatsAppGym, settings: WhatsAppGymSettings): Promise<void> {
  await ctx.say(
    `Open ${gym.name} on GymFlow:\n${settings.appHomeUrl}\n\nSign in with the same email and password you use here. You can book classes, see your wallet, scan the door QR and manage your membership.`,
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
