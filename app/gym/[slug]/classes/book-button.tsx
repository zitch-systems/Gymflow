'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bookClass, cancelBooking } from '@/lib/actions/classes';
import { useToast } from '@/lib/toast';

type MemberStatus = 'booked' | 'waitlisted' | null;

export function BookClassButton({
  slug,
  scheduleId,
  bookingDate,
  memberStatus,
  bookingId,
  isFull,
}: {
  slug: string;
  scheduleId: string;
  bookingDate: string;
  memberStatus: MemberStatus;
  bookingId: string | null;
  isFull: boolean;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<MemberStatus>(memberStatus);
  const [id, setId] = useState<string | null>(bookingId);
  const router = useRouter();
  const toast = useToast();

  const doBook = () =>
    start(async () => {
      const res = await bookClass(slug, scheduleId, bookingDate);
      if (res.ok) {
        setStatus(res.waitlisted ? 'waitlisted' : 'booked');
        setId(res.bookingId);
        toast(res.waitlisted ? "Added to the waitlist — we'll bump you up if a spot opens." : 'Booked!', 'success');
        router.refresh();
      } else {
        toast(res.error, 'error');
      }
    });

  const doCancel = () =>
    start(async () => {
      if (!id) return;
      const res = await cancelBooking(slug, id);
      if (res.ok) {
        setStatus(null);
        setId(null);
        toast('Booking cancelled', 'success');
        router.refresh();
      } else {
        toast(res.error ?? 'Could not cancel', 'error');
      }
    });

  if (status === 'booked' || status === 'waitlisted') {
    return (
      <span className="class-book-state">
        <span className={`gf-badge ${status === 'booked' ? 'gf-badge-success' : 'gf-badge-warning'}`}>
          {status === 'booked' ? 'Booked' : 'Waitlisted'}
        </span>
        <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" disabled={pending} onClick={doCancel}>
          {pending ? '…' : 'Cancel'}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`gf-btn gf-btn-sm ${isFull ? 'gf-btn-secondary' : 'gf-btn-primary'}`}
      disabled={pending}
      onClick={doBook}
    >
      {pending ? 'Saving…' : isFull ? 'Join waitlist' : 'Book'}
    </button>
  );
}
