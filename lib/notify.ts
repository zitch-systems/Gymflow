import 'server-only';

import { gymHasFeature } from '@/lib/entitlements';
import { firstName, fmtDate, watDateISO } from '@/lib/format';
import { sendMessage } from '@/lib/sms';
import { createAdminClient } from '@/lib/supabase/admin';
import { whatsappConfigured } from '@/lib/whatsapp/cloud-api';
import { notifyDoorEvent, sendRenewalReminder, type DoorAction } from '@/lib/whatsapp/notify';
import type { EmailContent } from '@/lib/email/layout';
import { memberAppUrl, sendGymEmail, type EmailCategory } from '@/lib/email/send';
import { MEMBER_TEMPLATES, paymentFailed, receipt, renewalReminder } from '@/lib/email/templates/member';

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
//
// The email half is now rendered by lib/email — the gym's own branding, the
// block vocabulary in lib/email/layout, and the templates in
// lib/email/templates/member. It used to be a local emailHtml() that escaped
// only & < >, which stopped being survivable the moment gym-controlled colours
// and logo URLs started reaching the markup: those land inside style="…" and
// src="…", where an unescaped quote is an attribute-injection, not a stray
// character. Escaping is now structural (the `t` tagged template) rather than
// something each call site has to remember.

/**
 * The gym columns delivery needs.
 *
 * The notif_* flags gate what may be sent; the rest is what the message is
 * DRESSED in. Callers that select only the toggles still work — branding
 * degrades to the GymFlow palette and platform URLs — so the branding columns
 * are optional here rather than required. Selecting GYM_EMAIL_COLUMNS
 * (lib/email/recipients) is what gets a member their own gym's logo, colour and
 * subdomain instead of ours.
 */
export type NotifyGym = {
  id: string;
  name?: string | null;
  subscription_plan?: string | null;
  notif_renewal_nudges?: boolean | null;
  notif_payment_receipts?: boolean | null;
  notif_membership_updates?: boolean | null;
  slug?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
};

/**
 * Who is being written to.
 *
 * No `wantsEmail`: this predates profiles.notification_email and every caller
 * selects contacts without it. sendGymEmail treats an absent flag as consent,
 * so a member who opted out still gets these three. Call sites that hold the
 * column (the Server Actions) go through sendGymEmail directly and pass it.
 */
export type NotifyRecipient = {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  /**
   * The member's profile id. Optional only so existing call sites keep
   * compiling; supplying it is what lets a reminder go out over the WhatsApp
   * Cloud API (with Renew/My membership buttons, into their existing thread)
   * instead of the plain Termii SMS-style fallback.
   */
  memberId?: string | null;
  /**
   * profiles.notification_email — the member's own email opt-out. Optional so
   * existing call sites keep compiling, but omitting it means sendGymEmail
   * sees no preference and treats that as consent, which is how members who
   * had switched renewal mail off kept receiving it. Pass it wherever the
   * column is available.
   */
  wantsEmail?: boolean | null;
};

export type DeliveryOutcome = { email: boolean; whatsapp: boolean };

/**
 * Render one member template and hand it to the gym-branded sender.
 *
 * The three deliver* functions below differ only in which template they pick,
 * so the tag/category pair comes from MEMBER_TEMPLATES rather than being spelt
 * out here — a per-function copy is how a template ends up tagged as one
 * category in analytics and gated as another in send.ts.
 */
async function sendMemberTemplate(
  gym: NotifyGym,
  to: NotifyRecipient,
  spec: { template: string; category: EmailCategory },
  content: EmailContent,
): Promise<boolean> {
  const res = await sendGymEmail({
    gym,
    // wantsEmail rides along so a member's own opt-out is honoured here the
    // same way the direct sendGymEmail callers honour it. `!== false` keeps
    // "not supplied" meaning consent, matching sendGymEmail's own default.
    to: { email: to.email, fullName: to.fullName, wantsEmail: to.wantsEmail !== false },
    category: spec.category,
    template: spec.template,
    subject: content.subject,
    preheader: content.preheader,
    blocks: content.blocks,
  });
  return res.ok;
}

const gymNameOf = (gym: NotifyGym): string => (gym.name ?? '').trim() || 'Your gym';

/**
 * Fire-and-forget WhatsApp confirmation for a door event staff performed.
 *
 * Called from the admin Server Actions, which hold an RLS-scoped client — and
 * whatsapp_contacts is service-role only, so this mints its own admin client
 * rather than making every call site pass one.
 *
 * Deliberately not awaited by its callers and deliberately incapable of
 * throwing: the check-in row is already written and the member is already
 * inside. A messaging failure must not turn that into an error the staffer has
 * to interpret while somebody stands at the desk waiting.
 */
export function deliverDoorEvent(params: {
  memberId: string;
  gymId: string;
  action: DoorAction;
  daysLeft?: number | null;
  sessionMinutes?: number | null;
}): void {
  if (!whatsappConfigured()) return;
  void (async () => {
    try {
      await notifyDoorEvent(createAdminClient(), params);
    } catch (e) {
      console.error('[notify] door event whatsapp failed:', (e as Error).message);
    }
  })();
}

// Renewal reminder: email on every tier, WhatsApp on Growth+. Both honor the
// gym's renewal-nudges toggle (the staff-visible switch in Settings).
export async function deliverRenewalReminder(
  gym: NotifyGym,
  to: NotifyRecipient,
  opts: { days: number; endDate?: string | null },
): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { email: false, whatsapp: false };
  if (gym.notif_renewal_nudges === false) return out;

  const gymName = gymNameOf(gym);
  const when = opts.days <= 0 ? 'today' : `in ${opts.days} day${opts.days === 1 ? '' : 's'}`;

  if (to.email) {
    // The template quotes the end date in the body, the panel and the preheader.
    // endDate is optional on this signature (no live caller omits it, but the
    // type allows it), so derive one from the day count rather than leaving a
    // hole in the middle of a sentence.
    const endIso = opts.endDate ?? watDateISO(new Date(Date.now() + Math.max(0, opts.days) * 86_400_000));
    out.email = await sendMemberTemplate(gym, to, MEMBER_TEMPLATES.renewalReminder, renewalReminder({
      gymName,
      firstName: firstName(to.fullName),
      daysLeft: opts.days,
      endDate: fmtDate(endIso),
      renewUrl: memberAppUrl(gym, '/dashboard/renew'),
    }));
  }

  if (to.phone && gymHasFeature({ subscription_plan: gym.subscription_plan ?? null }, 'whatsapp_reminders')) {
    // Prefer the WhatsApp Cloud API: it reaches the member in the same thread
    // they check in and pay from, carries Renew / My membership buttons that
    // lead straight back into the flow, and honours their opt-out. Termii
    // remains the fallback for members who have never messaged the business
    // number, where there is no thread and no contact row to send into.
    let delivered = false;
    if (to.memberId && whatsappConfigured()) {
      try {
        const admin = createAdminClient();
        const res = await sendRenewalReminder(admin, {
          memberId: to.memberId,
          memberPhone: to.phone,
          memberFirstName: firstName(to.fullName),
          gymId: gym.id,
          endDate: opts.endDate ?? watDateISO(new Date(Date.now() + Math.max(0, opts.days) * 86_400_000)),
          daysLeft: opts.days,
        });
        delivered = res.sent;
        // 'opted out' is a decision, not a delivery failure — falling through to
        // Termii would route around the member's own "stop".
        if (!res.sent && res.skipped === 'opted out') return out;
      } catch (e) {
        console.error('[notify] whatsapp cloud reminder failed:', (e as Error).message);
      }
    }

    if (!delivered) {
      const r = await sendMessage({
        to: to.phone,
        body: `${gymName}: your membership ends ${when}. Renew from the app to keep training.`,
        channel: 'whatsapp',
      });
      delivered = r.ok;
    }
    out.whatsapp = delivered;
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

  out.email = await sendMemberTemplate(gym, to, MEMBER_TEMPLATES.receipt, receipt({
    gymName: gymNameOf(gym),
    firstName: firstName(to.fullName),
    amountNaira: opts.amountNaira,
    // Both callers are Paystack fulfilment paths — a one-off renewal charge and
    // a recurring debit — so the money always arrived on a card. Front-desk cash
    // and transfer receipts never come through here: lib/actions/admin-member.ts
    // renders the same template with the method staff actually recorded.
    method: 'card',
    endDate: opts.endDate ? fmtDate(opts.endDate) : null,
    // Formatted from the WAT calendar day, not the server's: a charge that
    // settles after 23:00 UTC belongs to tomorrow in Lagos, and a receipt dated
    // the day before the member paid is the kind of thing they screenshot.
    paidOn: fmtDate(watDateISO()),
    dashboardUrl: memberAppUrl(gym),
  }));
  return out;
}

// Auto-renew charge failed: account-critical, so it sends whenever email is
// configured — a member with a broken card must hear about it even if the gym
// switched marketing-ish nudges off.
export async function deliverPaymentFailed(gym: NotifyGym, to: NotifyRecipient): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { email: false, whatsapp: false };
  if (!to.email) return out;

  out.email = await sendMemberTemplate(gym, to, MEMBER_TEMPLATES.paymentFailed, paymentFailed({
    gymName: gymNameOf(gym),
    firstName: firstName(to.fullName),
    updateCardUrl: memberAppUrl(gym, '/dashboard/renew'),
  }));
  return out;
}

// Bounded fan-out helper: run deliveries in small parallel slices so a big
// reminder run neither hammers the providers nor serializes into a timeout.
export async function inSlices<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(fn));
  }
}
