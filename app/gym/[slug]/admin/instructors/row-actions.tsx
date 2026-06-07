'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setInstructorActive } from '@/lib/actions/instructors';
import { useToast } from '@/lib/toast';

export function InstructorRowActions({ slug, userId, active }: { slug: string; userId: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setInstructorActive(slug, userId, !active);
          if (r.ok) {
            toast(active ? 'Deactivated' : 'Reactivated', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        })
      }
    >
      {active ? 'Deactivate' : 'Reactivate'}
    </button>
  );
}
