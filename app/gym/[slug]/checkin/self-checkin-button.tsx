'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { selfCheckIn } from '@/lib/actions/checkin';
import { useToast } from '@/lib/toast';

export function SelfCheckInButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  return (
    <button
      type="button"
      className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await selfCheckIn(slug);
          if (res.ok) {
            toast(
              res.daysLeft != null
                ? `Checked in! ${res.daysLeft} days left on your plan.`
                : `Checked in! Note: no active plan on file.`,
              'success',
            );
            router.refresh();
          } else {
            toast(res.error, 'error');
          }
        })
      }
    >
      {pending ? 'Checking in…' : 'Check me in'}
    </button>
  );
}
