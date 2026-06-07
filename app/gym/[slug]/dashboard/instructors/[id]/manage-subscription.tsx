'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelInstructorSubscription, setInstructorAutoRenew } from '@/lib/actions/member-instructors';
import { useToast } from '@/lib/toast';

export function ManageSubscription({
  slug,
  subscriptionId,
  autoRenew,
}: {
  slug: string;
  subscriptionId: string;
  autoRenew: boolean;
}) {
  const [pending, start] = useTransition();
  const [renew, setRenew] = useState(autoRenew);
  const router = useRouter();
  const toast = useToast();

  function toggleRenew() {
    const next = !renew;
    setRenew(next);
    start(async () => {
      const r = await setInstructorAutoRenew(slug, subscriptionId, next);
      if (!r.ok) {
        setRenew(!next);
        toast(r.error ?? 'Failed', 'error');
      } else {
        toast(next ? 'Auto-renew on' : 'Auto-renew off', 'success');
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
        <input type="checkbox" className="gf-check" checked={renew} disabled={pending} onChange={toggleRenew} />
        <span>Auto-renew monthly with my saved card</span>
      </label>
      <button
        type="button"
        className="gf-btn gf-btn-outline gf-btn-full"
        disabled={pending}
        onClick={() => {
          if (!confirm('Cancel this subscription? You keep access until the end date.')) return;
          start(async () => {
            const r = await cancelInstructorSubscription(slug, subscriptionId);
            if (r.ok) {
              toast('Subscription cancelled', 'success');
              router.refresh();
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          });
        }}
      >
        {pending ? 'Working…' : 'Cancel subscription'}
      </button>
    </div>
  );
}
