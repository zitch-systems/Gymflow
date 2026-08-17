import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtNaira } from '@/lib/format';
import { logOutbound, sendWhatsAppButtons, sendWhatsAppTemplate, sendWhatsAppText } from '@/lib/whatsapp/cloud-api';
import { contactForProfile } from '@/lib/whatsapp/contacts';
import { gymById, loadGymWhatsAppSettings } from '@/lib/whatsapp/settings';
import { intentByReference, markIntent } from '@/lib/whatsapp/payments';
import { TEMPLATES } from '@/lib/whatsapp/templates';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// Outbound messages GymFlow initiates: payment confirmations and renewal
// reminders.
//
// THE 24-HOUR WINDOW is the thing that shapes this file. Meta only allows a
// free-text message within 24 hours of the member's last inbound message;
// outside it, only an approved template may be sent. So:
//
//   • A payment confirmation almost always lands inside the window — they were
//     just talking to us — and gets a normal message with buttons.
//   • A renewal reminder almost never does, and gets a template.
//
// Both check `last_inbound_at` and pick accordingly, rather than assuming.

const WINDOW_MS = 24 * 60 * 60 * 1000;

function insideWindow(lastInboundAt: string | null): boolean {
  return Boolean(lastInboundAt) && Date.now() - new Date(lastInboundAt!).getTime() < WINDOW_MS;
}

/**
 * Tell a member their payment went through, in the thread they started it in.
 *
 * Called from the Paystack webhook AFTER fulfilment has already extended the
 * subscription. Never throws and never blocks acknowledgement of the webhook: a
 * missing confirmation message is an annoyance, a retried charge is not.
 */
export async function confirmWhatsAppPayment(
  admin: Admin,
  params: { reference: string; amountKobo: number; memberId?: string | null; gymId?: string | null },
): Promise<void> {
  try {
    const intent = await intentByReference(admin, params.reference);

    // Paid somewhere else — the web dashboard or the Android app — but the
    // member still has a WhatsApp thread with us. This used to return here, so
    // renewing anywhere but WhatsApp confirmed nothing on the channel the
    // member actually watches. The intent path below stays exactly as it was;
    // this only adds the members it never covered.
    if (!intent) {
      if (!params.memberId || !params.gymId) return;
      return confirmForMember(admin, {
        memberId: params.memberId, gymId: params.gymId, amountKobo: params.amountKobo,
      });
    }

    await markIntent(admin, params.reference, 'paid');

    // Read the end date back rather than being told it: fulfilment has already
    // written it, and quoting the stored value means the member is told the
    // same date the app will show them.
    const { data: subRow } = await admin
      .from('member_subscriptions')
      .select('end_date')
      .eq('member_id', intent.member_id).eq('gym_id', intent.gym_id)
      .order('end_date', { ascending: false })
      .limit(1).maybeSingle();
    const endDate = (subRow as { end_date: string | null } | null)?.end_date ?? null;

    const { data } = await admin
      .from('whatsapp_contacts').select('id, wa_id, last_inbound_at, active_gym_id')
      .eq('id', intent.contact_id).maybeSingle();
    const contact = data as { id: string; wa_id: string; last_inbound_at: string | null; active_gym_id: string | null } | null;
    if (!contact) return;

    const gym = await gymById(admin, intent.gym_id);
    const gymName = gym?.name ?? 'your gym';
    const amount = fmtNaira(params.amountKobo / 100);
    const until = endDate ? `\n\nYour membership now runs to ${endDate}.` : '';

    if (insideWindow(contact.last_inbound_at)) {
      const res = await sendWhatsAppButtons({
        to: contact.wa_id,
        body: `Payment received — ${amount} to ${gymName}. Thank you.${until}`,
        buttons: [
          { id: 'menu:checkin', title: 'Check in' },
          { id: 'menu:status', title: 'My membership' },
        ],
      });
      await logOutbound(admin, {
        contactId: contact.id, gymId: intent.gym_id, kind: 'buttons',
        body: `Payment received — ${amount}`, authoredBy: 'system', result: res,
      });
      return;
    }

    const res = await sendWhatsAppTemplate({
      to: contact.wa_id,
      name: TEMPLATES.paymentReceipt.name,
      language: TEMPLATES.paymentReceipt.language,
      components: [{ type: 'body', parameters: [
        { type: 'text', text: gymName },
        { type: 'text', text: amount },
        { type: 'text', text: endDate ?? 'your current end date' },
      ] }],
    });
    await logOutbound(admin, {
      contactId: contact.id, gymId: intent.gym_id, kind: 'template',
      body: `${TEMPLATES.paymentReceipt.name}: ${amount}`, authoredBy: 'system', result: res,
    });
  } catch (e) {
    console.error('[whatsapp/notify] payment confirmation failed:', (e as Error).message);
  }
}

/**
 * Confirm a payment for a member whose checkout did not start on WhatsApp.
 *
 * Same message, resolved from the profile rather than from a payment intent.
 * Silent when the member has no WhatsApp contact — most of the platform's
 * members don't, and that isn't a failure.
 */
async function confirmForMember(
  admin: Admin,
  params: { memberId: string; gymId: string; amountKobo: number },
): Promise<void> {
  const { data: profile } = await admin
    .from('profiles').select('phone').eq('id', params.memberId).maybeSingle();
  const contact = await contactForProfile(admin, params.memberId, (profile as { phone: string | null } | null)?.phone ?? null);
  if (!contact || contact.blocked) return;

  const gym = await gymById(admin, params.gymId);
  if (!gym) return;
  const settings = await loadGymWhatsAppSettings(admin, gym);
  if (!settings.enabled) return;

  const { data: subRow } = await admin
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', params.memberId).eq('gym_id', params.gymId)
    .order('end_date', { ascending: false })
    .limit(1).maybeSingle();
  const endDate = (subRow as { end_date: string | null } | null)?.end_date ?? null;
  const amount = fmtNaira(params.amountKobo / 100);

  if (insideWindow(contact.last_inbound_at)) {
    const body = `Payment received — ${amount} to ${gym.name}. Thank you.${endDate ? `\n\nYour membership now runs to ${endDate}.` : ''}`;
    const res = await sendWhatsAppButtons({
      to: contact.wa_id,
      body,
      buttons: [
        { id: 'menu:checkin', title: 'Check in' },
        { id: 'menu:status', title: 'My membership' },
      ],
    });
    await logOutbound(admin, {
      contactId: contact.id, gymId: params.gymId, kind: 'buttons',
      body, authoredBy: 'system', result: res,
    });
    return;
  }

  const res = await sendWhatsAppTemplate({
    to: contact.wa_id,
    name: TEMPLATES.paymentReceipt.name,
    language: TEMPLATES.paymentReceipt.language,
    components: [{ type: 'body', parameters: [
      { type: 'text', text: gym.name },
      { type: 'text', text: amount },
      { type: 'text', text: endDate ?? 'your current end date' },
    ] }],
  });
  await logOutbound(admin, {
    contactId: contact.id, gymId: params.gymId, kind: 'template',
    body: `${TEMPLATES.paymentReceipt.name}: ${amount}`, authoredBy: 'system', result: res,
  });
}

// ── The door ───────────────────────────────────────────────────────────────

export type DoorAction = 'checked_in' | 'checked_out';

/**
 * Tell a member they were checked in or out, when someone else did it for them.
 *
 * A member who checks themselves in over WhatsApp already sees the result in
 * the thread — the router replies to their own tap. This is for the other way
 * round: they read a 6-digit code out at reception, or the front desk checks
 * them in by hand, and until now the confirmation existed only on the staff
 * member's screen. The person whose membership it is got nothing.
 *
 * OPT-OUT. Skipped for a contact the gym has blocked. NOT skipped for one who
 * sent "stop" — that turns off reminders, and the reply to it says so in as
 * many words ("service replies still work"). This is a receipt for a thing that
 * just happened to their account at their request, which is the service half.
 *
 * Never throws. The member is already through the door; a failed message must
 * not turn the staffer's successful check-in into an error on their screen.
 */
export async function notifyDoorEvent(
  admin: Admin,
  params: {
    memberId: string;
    gymId: string;
    action: DoorAction;
    /** Shown on check-in when known. */
    daysLeft?: number | null;
    /** Shown on check-out when the visit's start is known. */
    sessionMinutes?: number | null;
  },
): Promise<{ sent: boolean; skipped: string | null }> {
  try {
    const { data: profile } = await admin
      .from('profiles').select('phone').eq('id', params.memberId).maybeSingle();
    const phone = (profile as { phone: string | null } | null)?.phone ?? null;

    const contact = await contactForProfile(admin, params.memberId, phone);
    if (!contact) return { sent: false, skipped: 'no whatsapp contact' };
    if (contact.blocked) return { sent: false, skipped: 'blocked' };

    const gym = await gymById(admin, params.gymId);
    if (!gym) return { sent: false, skipped: 'gym missing' };
    const settings = await loadGymWhatsAppSettings(admin, gym);
    if (!settings.enabled) return { sent: false, skipped: 'channel disabled' };

    const checkedIn = params.action === 'checked_in';
    // The gym's local clock. A member checking in at 00:20 in Lagos should not
    // be told a UTC time from the day before.
    const at = new Date().toLocaleTimeString('en-NG', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos',
    });

    const detail = checkedIn
      ? (typeof params.daysLeft === 'number'
        ? `${params.daysLeft} day${params.daysLeft === 1 ? '' : 's'} left on your membership.`
        : 'Your membership is active.')
      : (typeof params.sessionMinutes === 'number' && params.sessionMinutes > 0
        ? `You trained for ${formatSession(params.sessionMinutes)}.`
        : 'Thanks for training with us.');

    if (insideWindow(contact.last_inbound_at)) {
      const body = checkedIn
        ? `Checked in at ${gym.name} at ${at}.\n\n${detail}`
        : `Checked out of ${gym.name} at ${at}.\n\n${detail}`;
      const res = await sendWhatsAppButtons({
        to: contact.wa_id,
        body,
        buttons: checkedIn
          ? [{ id: 'menu:checkin', title: 'Check out' }, { id: 'menu:menu', title: 'Menu' }]
          : [{ id: 'menu:status', title: 'My membership' }, { id: 'menu:menu', title: 'Menu' }],
      });
      await logOutbound(admin, {
        contactId: contact.id, gymId: params.gymId, kind: 'buttons',
        body, authoredBy: 'system', result: res,
      });
      return { sent: res.ok, skipped: res.ok ? null : res.error };
    }

    const tpl = checkedIn ? TEMPLATES.checkedIn : TEMPLATES.checkedOut;
    const res = await sendWhatsAppTemplate({
      to: contact.wa_id,
      name: tpl.name,
      language: tpl.language,
      components: [{ type: 'body', parameters: [
        { type: 'text', text: gym.name },
        { type: 'text', text: at },
        { type: 'text', text: detail },
      ] }],
    });
    await logOutbound(admin, {
      contactId: contact.id, gymId: params.gymId, kind: 'template',
      body: `${tpl.name}: ${gym.name} ${at}`, authoredBy: 'system', result: res,
    });
    return { sent: res.ok, skipped: res.ok ? null : res.error };
  } catch (e) {
    return { sent: false, skipped: (e as Error).message };
  }
}

function formatSession(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minute${m === 1 ? '' : 's'}`;
  return m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${m}m`;
}

export type ReminderOutcome = { sent: boolean; skipped: string | null };

/**
 * A renewal reminder over WhatsApp.
 *
 * Skips a contact who opted out of reminders — a service reply is always
 * allowed, but this is a nudge, and "stop" has to mean stop.
 */
export async function sendRenewalReminder(
  admin: Admin,
  params: {
    memberId: string;
    memberPhone: string | null;
    memberFirstName: string | null;
    gymId: string;
    endDate: string;
    daysLeft: number;
  },
): Promise<ReminderOutcome> {
  try {
    const contact = await contactForProfile(admin, params.memberId, params.memberPhone);
    if (!contact) return { sent: false, skipped: 'no whatsapp contact' };
    if (!contact.opted_in) return { sent: false, skipped: 'opted out' };
    if (contact.blocked) return { sent: false, skipped: 'blocked' };

    const gym = await gymById(admin, params.gymId);
    if (!gym) return { sent: false, skipped: 'gym missing' };
    const settings = await loadGymWhatsAppSettings(admin, gym);
    if (!settings.enabled) return { sent: false, skipped: 'channel disabled' };

    const name = params.memberFirstName ?? 'there';
    const dayWord = params.daysLeft === 1 ? 'tomorrow' : `in ${params.daysLeft} days`;

    if (insideWindow(contact.last_inbound_at)) {
      const res = await sendWhatsAppButtons({
        to: contact.wa_id,
        body: `Hi ${name} — your ${gym.name} membership expires ${dayWord} (${params.endDate}).\n\nRenew now to keep training without a break.`,
        buttons: [
          { id: 'menu:renew', title: 'Renew now' },
          { id: 'menu:status', title: 'My membership' },
        ],
      });
      await logOutbound(admin, {
        contactId: contact.id, gymId: params.gymId, kind: 'buttons',
        body: `Renewal reminder — ${params.daysLeft}d`, authoredBy: 'system', result: res,
      });
      return { sent: res.ok, skipped: res.ok ? null : res.error };
    }

    const res = await sendWhatsAppTemplate({
      to: contact.wa_id,
      name: TEMPLATES.renewalReminder.name,
      language: TEMPLATES.renewalReminder.language,
      components: [{ type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: gym.name },
        { type: 'text', text: String(params.daysLeft) },
        { type: 'text', text: params.endDate },
      ] }],
    });
    await logOutbound(admin, {
      contactId: contact.id, gymId: params.gymId, kind: 'template',
      body: `Renewal reminder — ${params.daysLeft}d`, authoredBy: 'system', result: res,
    });
    return { sent: res.ok, skipped: res.ok ? null : res.error };
  } catch (e) {
    return { sent: false, skipped: (e as Error).message };
  }
}

/** A plain service message to a member, used by staff replies from the admin tab. */
export async function sendStaffReply(
  admin: Admin,
  params: { contactId: string; gymId: string; body: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await admin
    .from('whatsapp_contacts').select('id, wa_id, last_inbound_at').eq('id', params.contactId).maybeSingle();
  const contact = data as { id: string; wa_id: string; last_inbound_at: string | null } | null;
  if (!contact) return { ok: false, error: 'That contact no longer exists.' };

  // Outside the window a free-text reply is silently dropped by Meta, so refuse
  // it here with an explanation rather than showing the staffer a sent message
  // the member will never receive.
  if (!insideWindow(contact.last_inbound_at)) {
    return {
      ok: false,
      error: 'WhatsApp only allows a free reply within 24 hours of the member’s last message. They’ll need to message first.',
    };
  }

  const res = await sendWhatsAppText({ to: contact.wa_id, body: params.body });
  await logOutbound(admin, {
    contactId: contact.id, gymId: params.gymId, kind: 'text', body: params.body, authoredBy: 'staff', result: res,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
