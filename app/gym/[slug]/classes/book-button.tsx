'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bookClass } from '@/lib/actions/classes';
import { useToast } from '@/lib/toast';

export function BookClassButton({
  slug,
  scheduleId,
  bookingDate,
  alreadyBooked,
}: {
  slug: string;
  scheduleId: string;
  bookingDate: string;
  alreadyBooked: boolean;
}) {
  const [pending, start] = useTransition();
  const [booked, setBooked] = useState(alreadyBooked);
  const router = useRouter();
  const toast = useToast();

  if (booked) {
    return (
      <span className="gf-btn gf-btn-ghost gf-btn-sm" aria-disabled>
        Booked
      </span>
    );
  }

  return (
    <button
      type="button"
      className="gf-btn gf-btn-primary gf-btn-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await bookClass(slug, scheduleId, bookingDate);
          if (res.ok) {
            setBooked(true);
            toast('Booked!', 'success');
            router.refresh();
          } else {
            toast(res.error, 'error');
          }
        })
      }
    >
      {pending ? 'Booking…' : 'Book'}
    </button>
  );
}
