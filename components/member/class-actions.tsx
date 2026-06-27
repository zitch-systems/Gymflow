'use client';

import { useActionState } from 'react';
import { Check, Plus, X, Hourglass } from 'lucide-react';
import { bookClass, cancelBooking, type BookState } from '@/lib/actions/booking';

const INIT: BookState = { ok: false, error: null };

export function BookButton({ scheduleId }: { scheduleId: string }) {
  const [state, action, pending] = useActionState(bookClass, INIT);
  if (state.ok) return state.waitlisted
    ? <span className="bk-done"><Hourglass size={13} strokeWidth={2.6} /> Waitlisted</span>
    : <span className="bk-done"><Check size={13} strokeWidth={2.6} /> Booked</span>;
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
  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <button className="bk-cancel" disabled={pending} type="submit" aria-label="Cancel booking" title="Cancel booking">
        {pending ? '…' : <X size={15} strokeWidth={2} />}
      </button>
    </form>
  );
}
