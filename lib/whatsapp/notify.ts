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
  params: { reference: string; amountKobo: number },
): Promise<void> {
  try {
    const intent = await intentByReference(admin, params.reference);
    if (!intent) return; // Not a WhatsApp-initiated payment.

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
