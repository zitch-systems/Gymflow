import 'server-only';
import { Resend } from 'resend';

const FROM_DEFAULT = process.env.EMAIL_FROM ?? 'GymFlow <hello@gymflow.ng>';
const REPLY_TO = process.env.EMAIL_REPLY_TO;

function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

async function send(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const r = client();
  if (!r) {
    console.warn('[GF email] RESEND_API_KEY not set; skipping send to', to);
    return { ok: false, error: 'email_not_configured' };
  }
  try {
    const { error } = await r.emails.send({
      from: FROM_DEFAULT,
      to,
      subject,
      html,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function shell(title: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7fb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
<tr><td align="center" style="background:linear-gradient(135deg,#0a0a12,#1b1b2b);padding:32px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#11d18b,#4fe3a8);color:#fff;font-weight:800;font-size:18px;text-align:center;line-height:36px;">G</td>
<td style="vertical-align:middle;color:#fff;font-size:22px;font-weight:800;padding-left:10px;">Gym<span style="color:#11d18b;">Flow</span></td>
</tr></table></td></tr>
<tr><td style="padding:36px 32px 8px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;color:#0f172a;letter-spacing:-0.01em;">${escape(title)}</h1>
${bodyHtml}
</td></tr>
${
  ctaLabel && ctaUrl
    ? `<tr><td align="center" style="padding:8px 32px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:#11d18b;"><a href="${escape(ctaUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px;background:#11d18b;">${escape(ctaLabel)}</a></td></tr></table></td></tr>`
    : ''
}
<tr><td align="center" style="padding:24px 32px;background:#f4f7fb;border-top:1px solid #e2e8f0;">
<p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">GymFlow · 41 Ogudu Road, Lagos</p>
<p style="margin:0;font-size:12px;color:#94a3b8;">Questions? Reply to this email or call <a href="tel:+2348166938327" style="color:#11d18b;text-decoration:none;">08166938327</a>.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtNairaEmail(amount: number): string {
  if (amount == null) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

// ── High-level senders ───────────────────────────────────────────────────

export async function sendWelcome(to: string, name: string, gymName: string, dashboardUrl: string) {
  return send(
    to,
    `Welcome to ${gymName}`,
    shell(
      `Welcome, ${name}!`,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Your <strong>${escape(gymName)}</strong> membership is active. Tap below to open your member portal.</p>`,
      'Open my dashboard',
      dashboardUrl,
    ),
  );
}

export async function sendReceipt(to: string, args: { name: string; amount: number; plan: string; endDate: string; receiptUrl?: string }) {
  return send(
    to,
    `Payment receipt — ${fmtNairaEmail(args.amount)}`,
    shell(
      'Payment received',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — we got your <strong>${fmtNairaEmail(args.amount)}</strong> payment for the <strong>${escape(args.plan)}</strong> plan. Your membership is active until <strong>${escape(args.endDate)}</strong>.</p>`,
      args.receiptUrl ? 'View receipt' : undefined,
      args.receiptUrl,
    ),
  );
}

export async function sendExpiryReminder(to: string, args: { name: string; daysLeft: number; endDate: string; renewUrl: string; autoDebit: boolean }) {
  const daysWord = args.daysLeft === 1 ? 'tomorrow' : `in ${args.daysLeft} days`;
  return send(
    to,
    `Your membership expires ${daysWord}`,
    shell(
      `Heads up, ${escape(args.name)}`,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Your membership expires <strong>${daysWord}</strong> (${escape(args.endDate)}).</p>${
        args.autoDebit
          ? '<p style="margin:0 0 12px;font-size:14px;color:#64748b;">Your saved card will be charged automatically. No action needed unless you want to switch cards.</p>'
          : '<p style="margin:0 0 12px;font-size:14px;color:#64748b;">Tap below to renew — it takes 30 seconds.</p>'
      }`,
      'Renew now',
      args.renewUrl,
    ),
  );
}

export async function sendExpired(to: string, name: string, renewUrl: string) {
  return send(
    to,
    'Your membership has expired',
    shell(
      `Your membership expired`,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(name)} — your membership lapsed today. Renew below to get straight back in.</p>`,
      'Renew now',
      renewUrl,
    ),
  );
}

export async function sendAutoDebitSuccess(to: string, args: { name: string; amount: number; endDate: string }) {
  return send(
    to,
    `Auto-renewal successful — ${fmtNairaEmail(args.amount)}`,
    shell(
      'Auto-renewal successful',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — we charged <strong>${fmtNairaEmail(args.amount)}</strong> to your saved card. Your membership is now valid through <strong>${escape(args.endDate)}</strong>.</p>`,
    ),
  );
}

export async function sendAutoDebitFailure(to: string, args: { name: string; reason: string; attempts: number; renewUrl: string }) {
  return send(
    to,
    `Auto-renewal failed — please update your card`,
    shell(
      'Auto-renewal failed',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — we couldn't charge your saved card (attempt ${args.attempts} of 3). Reason: ${escape(args.reason)}.</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">Tap below to update your card or pay manually before your access is paused.</p>`,
      'Fix it now',
      args.renewUrl,
    ),
  );
}

export async function sendClassReminder(
  to: string,
  args: { name: string; className: string; classDate: string; classTime?: string | null; classesUrl: string },
) {
  return send(
    to,
    `Reminder: ${escape(args.className)} ${args.classTime ? `at ${escape(args.classTime)}` : 'today'}`,
    shell(
      'See you soon',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — just a quick reminder that <strong>${escape(args.className)}</strong> is today${args.classTime ? ` at <strong>${escape(args.classTime)}</strong>` : ''}.</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">If you can no longer make it, please cancel so the next person on the waitlist gets your spot.</p>`,
      'View your class',
      args.classesUrl,
    ),
  );
}

export async function sendBookingConfirmed(
  to: string,
  args: { name: string; className: string; classDate: string; classTime?: string | null; classesUrl: string },
) {
  return send(
    to,
    `You're booked for ${escape(args.className)} on ${escape(args.classDate)}`,
    shell(
      'Your booking is confirmed',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — you're confirmed for <strong>${escape(args.className)}</strong> on <strong>${escape(args.classDate)}</strong>${args.classTime ? ` at ${escape(args.classTime)}` : ''}.</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">If something comes up, please cancel ahead of time so the next person on the waitlist gets the spot.</p>`,
      'View your class',
      args.classesUrl,
    ),
  );
}

export async function sendWaitlistJoined(
  to: string,
  args: { name: string; className: string; classDate: string; classTime?: string | null; classesUrl: string; position?: number | null },
) {
  const posSentence = args.position ? `You're #${args.position} on the waitlist.` : 'You\'re on the waitlist.';
  return send(
    to,
    `Waitlisted for ${escape(args.className)} — we'll text you if a spot opens`,
    shell(
      'You\'re on the waitlist',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — <strong>${escape(args.className)}</strong> on <strong>${escape(args.classDate)}</strong>${args.classTime ? ` at ${escape(args.classTime)}` : ''} was full when you booked, so we\'ve added you to the waitlist. ${escape(posSentence)}</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">If anyone cancels we\'ll automatically promote the next person in line and email you the confirmation.</p>`,
      'View your class',
      args.classesUrl,
    ),
  );
}

export async function sendWaitlistPromoted(
  to: string,
  args: { name: string; className: string; classDate: string; classTime?: string | null; classesUrl: string },
) {
  return send(
    to,
    `You're in! Your ${escape(args.className)} spot just opened up`,
    shell(
      'A spot opened up!',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — someone cancelled their <strong>${escape(args.className)}</strong> booking on <strong>${escape(args.classDate)}</strong>${args.classTime ? ` at ${escape(args.classTime)}` : ''}, so you're off the waitlist and confirmed in.</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">See you at the gym! If you can't make it, please cancel so the next person on the waitlist gets the spot.</p>`,
      'View your class',
      args.classesUrl,
    ),
  );
}

export async function sendPayoutPaid(
  to: string,
  args: { name: string; amount: number; bankName: string; accountLast4: string; earningsUrl: string },
) {
  return send(
    to,
    `Payout sent — ${fmtNairaEmail(args.amount)}`,
    shell(
      'Your payout is on its way',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — your payout of <strong>${fmtNairaEmail(args.amount)}</strong> has been sent to your ${escape(args.bankName)} account ending in <strong>${escape(args.accountLast4)}</strong>. Nigerian bank transfers normally land within minutes; settlement can take up to a few hours during weekends or holidays.</p>`,
      'View earnings',
      args.earningsUrl,
    ),
  );
}

export async function sendPayoutFailed(
  to: string,
  args: { name: string; amount: number; reason: 'failed' | 'reversed'; earningsUrl: string },
) {
  const headline = args.reason === 'reversed' ? 'Your payout was reversed' : 'Your payout failed';
  const explainer =
    args.reason === 'reversed'
      ? `the receiving bank returned the funds. The amount is back in your available balance — please double-check your bank details before requesting again.`
      : `the transfer didn't go through. The amount is back in your available balance — please double-check your bank details before requesting again.`;
  return send(
    to,
    `${headline} — ${fmtNairaEmail(args.amount)}`,
    shell(
      headline,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — your payout of <strong>${fmtNairaEmail(args.amount)}</strong> was processed but ${explainer}</p>`,
      'Check earnings',
      args.earningsUrl,
    ),
  );
}

export async function sendPlatformRenewalFailure(
  to: string,
  args: { gymName: string; reason: string; attempts: number; billingUrl: string },
) {
  return send(
    to,
    `Your GymFlow subscription couldn't be renewed`,
    shell(
      'Subscription renewal failed',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi — we couldn't charge your saved card for the GymFlow subscription on <strong>${escape(args.gymName)}</strong> (attempt ${args.attempts} of 3). Reason: ${escape(args.reason)}.</p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">If we can't take payment in the next 2 days your gym is suspended. Update your card or renew manually below.</p>`,
      'Fix billing',
      args.billingUrl,
    ),
  );
}

export async function sendTempPassword(to: string, args: { name: string; gymName: string; tempPassword: string; loginUrl: string }) {
  return send(
    to,
    `Your ${args.gymName} login`,
    shell(
      `Welcome to ${escape(args.gymName)}`,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#475569;">Hi ${escape(args.name)} — your account is ready. Sign in with:</p><p style="margin:0 0 16px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:14px;background:#f4f7fb;border:1px solid #e2e8f0;padding:12px;border-radius:8px;">Email: <strong>${escape(to)}</strong><br>Password: <strong>${escape(args.tempPassword)}</strong></p><p style="margin:0 0 12px;font-size:14px;color:#64748b;">You'll be asked to set a new password on first sign-in.</p>`,
      'Sign in',
      args.loginUrl,
    ),
  );
}
