'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approvePause, resumeMembership, extendMembership, cancelMembership } from '@/lib/actions/subscription';
import { useToast } from '@/lib/toast';

export function MemberAdminActions({ slug, membershipId, status }: { slug: string; membershipId: string; status: string }) {
  const [pending, start] = useTransition();
  const [extendDays, setExtendDays] = useState(7);
  const router = useRouter();
  const toast = useToast();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(success, 'success');
        router.refresh();
      } else {
        toast(r.error ?? 'Failed', 'error');
      }
    });
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          type="number"
          min="1"
          max="365"
          className="gf-input"
          value={extendDays}
          onChange={(e) => setExtendDays(Number(e.target.value))}
          style={{ width: 80 }}
        />
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          disabled={pending}
          onClick={() => run(() => extendMembership(slug, membershipId, extendDays), `Extended by ${extendDays} days`)}
        >
          Extend
        </button>
      </div>

      {status === 'pause_requested' && (
        <button
          type="button"
          className="gf-btn gf-btn-primary gf-btn-sm"
          disabled={pending}
          onClick={() => run(() => approvePause(slug, membershipId), 'Pause approved')}
        >
          Approve pause
        </button>
      )}
      {status === 'paused' && (
        <button
          type="button"
          className="gf-btn gf-btn-primary gf-btn-sm"
          disabled={pending}
          onClick={() => run(() => resumeMembership(slug, membershipId), 'Membership resumed')}
        >
          Resume
        </button>
      )}
      {status !== 'cancelled' && (
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          disabled={pending}
          onClick={() => {
            if (!confirm('Cancel this membership immediately? Auto-renew will be disabled.')) return;
            run(() => cancelMembership(slug, membershipId), 'Membership cancelled');
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
