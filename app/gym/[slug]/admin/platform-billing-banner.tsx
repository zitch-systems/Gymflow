import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

// Surface the gym's own platform-fee state at the top of every admin page so
// owners know when the auto-renew is in trouble. Past_due means the renewals
// cron is mid-retry; if they don't act the gym is eventually suspended.
// Renewal-due-soon is a softer warning when the period ends within 7 days
// AND no card is on file (informational only).
//
// `daysUntilRenewal` is computed in the layout (server component, runs per
// request) rather than here — keeps this component pure for the React Compiler
// purity rule and lets us swap in a Date provider in tests.

const MANAGER_ROLES = new Set(['gym_owner', 'owner', 'manager']);

type Props = {
  subscriptionStatus: string | null;
  daysUntilRenewal: number | null;
  role: string;
};

export function PlatformBillingBanner({ subscriptionStatus, daysUntilRenewal, role }: Props) {
  // Only owners/managers can fix billing — don't distract front-desk/accountant.
  if (!MANAGER_ROLES.has(role)) return null;

  if (subscriptionStatus === 'past_due') {
    return (
      <div
        role="alert"
        style={{
          padding: '12px 16px',
          margin: '0 0 16px',
          background: 'rgba(220, 60, 60, 0.08)',
          border: '1px solid rgba(220, 60, 60, 0.35)',
          color: 'var(--gf-text)',
          borderRadius: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          fontSize: 14,
        }}
      >
        <AlertTriangle size={18} strokeWidth={2} style={{ flexShrink: 0, color: '#dc3c3c' }} />
        <div style={{ flex: 1 }}>
          <strong>Your GymFlow subscription couldn&apos;t be renewed.</strong>{' '}
          We&apos;re retrying for 3 days; after that your gym is suspended.
          Update your card to settle now.
        </div>
        <Link href="/admin/billing" className="gf-btn gf-btn-primary gf-btn-sm">
          Fix billing
        </Link>
      </div>
    );
  }

  if (subscriptionStatus === 'cancelled') {
    return (
      <div
        role="alert"
        style={{
          padding: '12px 16px',
          margin: '0 0 16px',
          background: 'rgba(220, 60, 60, 0.12)',
          border: '1px solid rgba(220, 60, 60, 0.45)',
          color: 'var(--gf-text)',
          borderRadius: 10,
          fontSize: 14,
        }}
      >
        <strong>Your GymFlow subscription is cancelled.</strong>{' '}
        Contact <a className="gf-link" href="mailto:hello@gymflow.ng">hello@gymflow.ng</a> to reactivate.
      </div>
    );
  }

  // Informational: renewal due within 7 days. Soft note, no big alarm.
  if (daysUntilRenewal !== null && daysUntilRenewal >= 0 && daysUntilRenewal <= 7) {
    return (
      <div
        style={{
          padding: '10px 14px',
          margin: '0 0 16px',
          background: 'var(--gf-elevated)',
          border: '1px solid var(--gf-border)',
          color: 'var(--gf-text-secondary)',
          borderRadius: 10,
          fontSize: 13,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>
          Your GymFlow subscription renews in {daysUntilRenewal} day{daysUntilRenewal === 1 ? '' : 's'}.
        </span>
        <Link href="/admin/billing" className="gf-link" style={{ fontSize: 13 }}>
          Manage billing →
        </Link>
      </div>
    );
  }

  return null;
}
