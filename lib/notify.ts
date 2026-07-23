import 'server-only';
import { sendEmail } from '@/lib/email';
import { sendMessage } from '@/lib/sms';
import { gymHasFeature } from '@/lib/entitlements';

// Member-facing delivery beyond the in-app inbox. Until now every
// notification was channel:'in_app' only — reminders and receipts never
// reached a member who wasn't already inside the app. This module fans a
// notification out to email (Resend) and WhatsApp (Termii), respecting:
//
//   • per-gym toggles (gyms.notif_renewal_nudges / notif_payment_receipts)
//   • the gym's plan tier (whatsapp_reminders is Growth+; email is all tiers)
//   • provider configuration (each sender fails open when its key is absent)
//
// Everything here is best-effort: callers write the in-app row first (the
// system of record) and treat external delivery as a bonus channel.

export type NotifyGym = {
  id: string;
  name?: string | null;
  subscription_plan?: string | null;
  notif_renewal_nudges?: boolean | null;
  notif_payment_receipts?: boolean | null;
};

export type NotifyRecipient = {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
};

export type DeliveryOutcome = { email: boolean; whatsapp: boolean };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Small shared wrapper so every mail reads as the gym writing to its member.
function emailHtml(gymName: string, heading: string, lines: string[]): string {
  return [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="margin:0 0 12px;font-size:18px">${esc(heading)}</h2>`,
    ...lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5;color:#333">${l}</p>`),
    `<p style="margin:18px 0 0;font-size:12px;color:#888">Sent by ${esc(gymName)} via GymFlow.</p>`,
    `</div>`,
  ].join('');
}

const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';

// Renewal reminder: email on every tier, WhatsApp on Growth+. Both honor the
// gym's renewal-nudges toggle (the staff-visible switch in Settings).
export async function deliverRenewalReminder(
  gym: NotifyGym,
  to: NotifyRecipient,
  opts: { days: number; endDate?: string | null },
): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { email: false, whatsapp: false };
  if (gym.notif_renewal_nudges === false) return out;

  const gymName = gym.name ?? 'Your gym';
  const when = opts.days <= 0 ? 'today' : `in ${opts.days} day${opts.days === 1 ? '' : 's'}`;

  if (to.email) {
    const r = await sendEmail({
      to: to.email,
      subject: `Your ${gymName} membership ends ${when}`,
      html: emailHtml(gymName, 'Membership expiring soon', [
        `Hi ${esc(first(to.fullName))},`,
        `Your membership at <strong>${esc(gymName)}</strong> ends ${esc(when)}${opts.endDate ? ` (on ${esc(opts.endDate)})` : ''}.`,
        `Renew from the app to keep training without interruption.`,
      ]),
      text: `Your membership at ${gymName} ends ${when}. Renew from the app to keep training.`,
    });
    out.email = r.ok;
  }

  if (to.phone && gymHasFeature({ subscription_plan: gym.subscription_plan ?? null }, 'whatsapp_reminders')) {
    const r = await sendMessage({
      to: to.phone,
      body: `${gymName}: your membership ends ${when}. Renew from the app to keep training.`,
      channel: 'whatsapp',
    });
    out.whatsapp = r.ok;
  }

  return out;
}

// Payment receipt: email-only (receipts are a paper trail; WhatsApp stays
// reserved for time-sensitive nudges). Honors the payment-receipts toggle.
export async function deliverReceipt(
  gym: NotifyGym,
  to: NotifyRecipient,
  opts: { amountNaira: number; endDate?: string | null },
): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { email: false, whatsapp: false };
  if (gym.notif_payment_receipts === false || !to.email) return out;

  const gymName = gym.name ?? 'Your gym';
  const amount = `₦${opts.amountNaira.toLocaleString('en-NG')}`;
  const r = await sendEmail({
    to: to.email,
    subject: `Payment received — ${amount} at ${gymName}`,
    html: emailHtml(gymName, 'Payment received', [
      `Hi ${esc(first(to.fullName))},`,
      `We received <strong>${esc(amount)}</strong> for your membership at <strong>${esc(gymName)}</strong>.`,
      opts.endDate ? `Your access now runs to <strong>${esc(opts.endDate)}</strong>.` : `Your membership has been renewed.`,
      `This email is your receipt — no action needed.`,
    ]),
    text: `Payment received: ${amount} at ${gymName}.${opts.endDate ? ` Access extended to ${opts.endDate}.` : ''}`,
  });
  out.email = r.ok;
  return out;
}

// Auto-renew charge failed: account-critical, so it sends whenever email is
// configured — a member with a broken card must hear about it even if the gym
// switched marketing-ish nudges off.
export async function deliverPaymentFailed(gym: NotifyGym, to: NotifyRecipient): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { email: false, whatsapp: false };
  if (!to.email) return out;

  const gymName = gym.name ?? 'Your gym';
  const r = await sendEmail({
    to: to.email,
    subject: `Action needed — your ${gymName} auto-renew payment failed`,
    html: emailHtml(gymName, 'Payment failed', [
      `Hi ${esc(first(to.fullName))},`,
      `Your auto-renew charge for <strong>${esc(gymName)}</strong> didn't go through.`,
      `Update your card from the app (Dashboard → Renew) to keep your access. Paystack will retry automatically for a few days.`,
    ]),
    text: `Your auto-renew charge for ${gymName} failed. Update your card from the app to keep access.`,
  });
  out.email = r.ok;
  return out;
}

// Bounded fan-out helper: run deliveries in small parallel slices so a big
// reminder run neither hammers the providers nor serializes into a timeout.
export async function inSlices<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn));
  }
}
