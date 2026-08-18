import 'server-only';

import { supportAddress } from '@/lib/email';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { adminOrNull, getGymOwnerEmails } from '@/lib/email/recipients';
import { instructorBankChanged, payoutAccountChanged, type PayoutAccountAction } from '@/lib/email/templates/platform';
import { fmtDateTime } from '@/lib/format';

// Second-line-of-defense email alerts for payout-destination changes. On top of
// the password re-auth the payout actions already require, these tell the money
// recipient "your payout bank just changed — if it wasn't you, act now", so a
// hijacked staff session that survives re-auth still surfaces to the owner.
//
// All best-effort: the owner lookup runs via the service-role client (a manager
// can't read the owner's staff link under RLS) and every step is wrapped so an
// email failure never breaks the payout action that triggered it.

// Same vocabulary as the template, kept as a local alias so the two exported
// signatures below — and their callers in lib/actions — are untouched.
type PayoutAction = PayoutAccountAction;

// Notify every active gym owner that a gym payout account changed. actorId is
// resolved to a display name from a second service-role read. Pass null for
// an automated change (e.g. the reconciliation cron recreating a subaccount)
// — there's no profile to look up, and rendering it as "a staff member" would
// misreport an unattended job as a human action, undermining the exact
// hijacked-session signal this alert exists to preserve.
export async function alertGymPayoutChanged(params: {
  gymId: string;
  gymName: string;
  action: PayoutAction;
  bankName: string;
  last4: string;
  actorId: string | null;
}): Promise<void> {
  // Skip the service-role owner lookup entirely when email isn't configured.
  if (!process.env.RESEND_API_KEY) return;
  try {
    const admin = adminOrNull();
    if (!admin) return;
    const emails = await getGymOwnerEmails(admin, params.gymId);
    if (emails.length === 0) return;

    // "Changed by" is the whole point of the alert: an owner who can't tell
    // whether it was their own manager has nothing to act on. A profile we
    // can't read degrades to the vague form rather than printing a bare uuid.
    let actorName = 'GymFlow’s automated reconciliation';
    if (params.actorId) {
      const { data: actor } = await admin.from('profiles').select('full_name, email').eq('id', params.actorId).maybeSingle();
      const row = actor as { full_name: string | null; email: string | null } | null;
      actorName = row?.full_name?.trim() || row?.email || 'a staff member';
    }

    await sendPlatformEmail({
      to: emails,
      ...payoutAccountChanged({
        gymName: params.gymName,
        action: params.action,
        bankName: params.bankName,
        last4: params.last4,
        actorName,
        changedAt: fmtDateTime(new Date().toISOString()),
        supportUrl: `mailto:${supportAddress()}`,
        payoutSettingsUrl: platformAppUrl('/admin/settings'),
      }),
      template: 'payout_account_changed',
    });
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
    await sendPlatformEmail({
      to: params.email,
      ...instructorBankChanged({
        gymName: params.gymName,
        bankName: params.bankName,
        last4: params.last4,
        supportUrl: `mailto:${supportAddress()}`,
        payoutSettingsUrl: platformAppUrl('/coach/payouts'),
      }),
      template: 'instructor_bank_changed',
    });
  } catch {
    // best-effort
  }
}
