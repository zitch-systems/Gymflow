import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail, escapeHtml } from '@/lib/email';

// Second-line-of-defense email alerts for payout-destination changes. On top of
// the password re-auth the payout actions already require, these tell the money
// recipient "your payout bank just changed — if it wasn't you, act now", so a
// hijacked staff session that survives re-auth still surfaces to the owner.
//
// All best-effort: owner lookup runs via the service-role client (a manager
// can't read the owner's staff link under RLS) and every step is wrapped so an
// email failure never breaks the payout action that triggered it.

type PayoutAction = 'added' | 'activated' | 'removed';

const VERB: Record<PayoutAction, string> = {
  added: 'added',
  activated: 'set as the active payout account',
  removed: 'removed',
};

function alertBody(opts: { heading: string; lines: string[] }): { html: string; text: string } {
  const text = [opts.heading, '', ...opts.lines, '',
    'If you did not make or authorise this change, contact support immediately — someone may have access to a staff account.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(opts.heading)}</h2>
      <table style="font-size:14px;line-height:1.6;border-collapse:collapse">
        ${opts.lines.map((l) => `<tr><td style="padding:2px 0">${escapeHtml(l)}</td></tr>`).join('')}
      </table>
      <p style="font-size:13px;color:#b91c1c;margin:16px 0 0">
        If you did not make or authorise this change, contact support immediately — someone may have access to a staff account.
      </p>
    </div>`;
  return { html, text };
}

// Notify every active gym owner that a gym payout account changed. actorId is
// resolved to a display name from the same service-role read.
export async function alertGymPayoutChanged(params: {
  gymId: string;
  gymName: string;
  action: PayoutAction;
  bankName: string;
  last4: string;
  actorId: string;
}): Promise<void> {
  // Skip the service-role owner lookup entirely when email isn't configured.
  if (!process.env.RESEND_API_KEY) return;
  try {
    const admin = createAdminClient();
    const { data: links } = await admin
      .from('gym_staff_links')
      .select('user_id')
      .eq('gym_id', params.gymId)
      .eq('role', 'gym_owner')
      .eq('is_active', true);
    const ownerIds = [...new Set(((links ?? []) as { user_id: string | null }[]).map((l) => l.user_id).filter(Boolean) as string[])];
    if (ownerIds.length === 0) return;

    // One read covers both the owner emails and the actor's display name.
    const lookupIds = [...new Set([...ownerIds, params.actorId])];
    const { data: profiles } = await admin.from('profiles').select('id, email, full_name').in('id', lookupIds);
    const rows = (profiles ?? []) as { id: string; email: string | null; full_name: string | null }[];
    const emails = [...new Set(rows.filter((p) => ownerIds.includes(p.id)).map((p) => p.email).filter(Boolean) as string[])];
    if (emails.length === 0) return;
    const actor = rows.find((p) => p.id === params.actorId);
    const actorName = actor?.full_name?.trim() || actor?.email || 'a staff member';

    const { html, text } = alertBody({
      heading: `Payout account ${VERB[params.action]} for ${params.gymName}`,
      lines: [
        `Bank: ${params.bankName} ••••${params.last4}`,
        `Changed by: ${actorName}`,
        `Gym: ${params.gymName}`,
      ],
    });
    await sendEmail({ to: emails, subject: `Payout account ${VERB[params.action]} — ${params.gymName}`, html, text });
  } catch {
    // best-effort — never break the payout action on an alert failure
  }
}

// Notify an instructor that their own payout bank details changed.
export async function alertInstructorBankChanged(params: {
  email: string | null | undefined;
  gymName: string;
  bankName: string;
  last4: string;
}): Promise<void> {
  try {
    if (!params.email) return;
    const { html, text } = alertBody({
      heading: 'Your payout account was updated',
      lines: [
        `Bank: ${params.bankName} ••••${params.last4}`,
        `Gym: ${params.gymName}`,
        'Future payouts of your earnings will go to this account.',
      ],
    });
    await sendEmail({ to: params.email, subject: 'Your GymFlow payout account was updated', html, text });
  } catch {
    // best-effort
  }
}
