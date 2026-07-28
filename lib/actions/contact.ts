'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { platformAlertRecipients } from '@/lib/email';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { contactAck, contactReceived } from '@/lib/email/templates/platform';

export type ContactState = { ok: boolean; error: string | null };

// Marketing contact form → a support_tickets row (gym_id null ⇒ shows as
// "Platform" on the superadmin Support page). The form is public, so the
// insert uses the service-role client; `website` is a honeypot field.
export async function submitContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  if (String(formData.get('website') ?? '')) return { ok: true, error: null }; // bot — pretend success

  const first = String(formData.get('first') ?? '').trim().slice(0, 80);
  const email = String(formData.get('email') ?? '').trim().slice(0, 254);
  const message = String(formData.get('message') ?? '').trim().slice(0, 2000);
  if (!first || !email) return { ok: false, error: 'Name and email are required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };

  const last = String(formData.get('last') ?? '').trim().slice(0, 80);
  const gymName = String(formData.get('gym') ?? '').trim().slice(0, 120);
  const topic = String(formData.get('topic') ?? 'Something else').trim().slice(0, 60);

  // Public + service-role write ⇒ throttle is the only server-side guard
  // beyond the honeypot. Per-IP so one bot can't flood support_tickets.
  if (!(await rateLimit(`contact:ip:${await clientIp()}`, 5, 600))) {
    return { ok: false, error: 'Too many messages in a short time — please wait a few minutes, or email hello@gymflow.ng.' };
  }

  const name = [first, last].filter(Boolean).join(' ');
  const priority = topic === 'Booking a demo' ? 'high' : 'normal';

  try {
    const admin = createAdminClient();
    const { error } = await admin.from('support_tickets').insert({
      subject: `${topic} — ${name}`,
      body: [`From: ${name} <${email}>`, gymName ? `Gym: ${gymName}` : null, '', message || '(no message)'].filter((s) => s !== null).join('\n'),
      status: 'open', priority,
    });
    if (error) return { ok: false, error: 'Could not send right now — email us at hello@gymflow.ng.' };
  } catch {
    return { ok: false, error: 'Could not send right now — email us at hello@gymflow.ng.' };
  }

  // The ticket row is the system of record; these two are what make anyone look
  // at it. Both best-effort — a form that says "couldn't send" after the ticket
  // landed is worse than a silent mail failure.
  try {
    const alerts = platformAlertRecipients();
    // allSettled, not all: one rejected send must not leave the other's
    // rejection unhandled.
    await Promise.allSettled([
      // Unset PLATFORM_ALERT_EMAILS means nobody is paged; skip rather than
      // throw, the same posture the rest of lib/email takes on missing config.
      alerts.length ? sendPlatformEmail({
        to: alerts,
        ...contactReceived({
          name,
          email,
          gymName: gymName || null,
          topic,
          message: message || '',
          priority,
          ticketUrl: platformAppUrl('/superadmin/support'),
        }),
        // Replies go straight to the person who wrote in, not to our own inbox.
        replyTo: email,
        template: 'contact_received',
      }) : Promise.resolve(),
      sendPlatformEmail({
        to: email,
        ...contactAck({
          name: first,
          topic,
          responseTime: priority === 'high' ? 'one working day' : 'two working days',
          pricingUrl: platformAppUrl('/pricing'),
        }),
        template: 'contact_ack',
      }),
    ]);
  } catch { /* the ticket is already open */ }

  return { ok: true, error: null };
}
