'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelInstructorSubscription } from '@/lib/actions/member-instructors';
import { useToast } from '@/lib/toast';

export function ManageSubscription({ slug, subscriptionId }: { slug: string; subscriptionId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
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
      {pending ? 'Cancelling…' : 'Cancel subscription'}
    </button>
  );
}
