'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';
import { bookClass, cancelBooking, type BookState } from '@/lib/actions/booking';

const INIT: BookState = { ok: false, error: null };

export function BookButton({ scheduleId }: { scheduleId: string }) {
  const [state, action, pending] = useActionState(bookClass, INIT);
  // Matches the schedule card's booked state in revamp/member.html.
  if (state.ok) return state.waitlisted
    ? <span className="gf-badge gf-badge-warning" style={{ padding: '5px 9px' }}>Waitlisted</span>
    : <span className="gf-badge gf-badge-success" style={{ padding: '5px 9px' }}>Booked</span>;
  return (
    <form action={action} className="bk-form">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <button className="bk-btn" disabled={pending} type="submit">
        {pending ? 'Booking…' : <><Plus size={14} strokeWidth={2.6} /> Book</>}
      </button>
      {state.error && <span className="bk-err">{state.error}</span>}
    </form>
  );
}

export function CancelButton({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(cancelBooking, INIT);
  if (state.ok) return <span className="bk-cancelled">Cancelled</span>;
  // The prototype's booking rows use a plain-text Cancel button (.bkg .cancel).
  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <button className="cancel" disabled={pending} type="submit" aria-label="Cancel booking">
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
    </form>
  );
}
