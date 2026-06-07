'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestPause, cancelAtPeriodEnd } from '@/lib/actions/subscription';
import { useToast } from '@/lib/toast';

export function SubscriptionActions({ slug, status, autoRenew }: { slug: string; status: string; autoRenew: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (status === 'pause_requested') {
    return (
      <p className="gf-form-hint" style={{ margin: 0, color: 'var(--gf-warning)' }}>
        Pause requested — waiting for staff to approve.
      </p>
    );
  }
  if (status === 'paused') {
    return (
      <p className="gf-form-hint" style={{ margin: 0, color: 'var(--gf-text-secondary)' }}>
        Membership paused. Contact the gym to resume.
      </p>
    );
  }
  if (status === 'cancelled') {
    return (
      <p className="gf-form-hint" style={{ margin: 0, color: 'var(--gf-text-secondary)' }}>
        Cancelled. Renew anytime to restart.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="gf-btn gf-btn-ghost gf-btn-sm"
        disabled={pending}
        onClick={() => {
          const reason = prompt('Pause reason (optional)') ?? '';
          start(async () => {
            const r = await requestPause(slug, reason);
            if (r.ok) {
              toast('Pause requested — staff will approve shortly', 'success');
              router.refresh();
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          });
        }}
      >
        Request pause
      </button>
      {autoRenew && (
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          disabled={pending}
          onClick={() => {
            if (!confirm("Cancel auto-renew? You'll keep access until your current period ends.")) return;
            start(async () => {
              const r = await cancelAtPeriodEnd(slug);
              if (r.ok) {
                toast('Auto-renew cancelled', 'success');
                router.refresh();
              } else {
                toast(r.error ?? 'Failed', 'error');
              }
            });
          }}
        >
          Cancel auto-renew
        </button>
      )}
    </div>
  );
}
