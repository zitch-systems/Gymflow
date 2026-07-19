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

// Full-width booking button for the class-detail page (revamp/member.html
// classdetail .cd-book). Same action + waitlist handling as BookButton, styled
// as a large primary CTA instead of the compact schedule-row button.
export function BookButtonLarge({ scheduleId }: { scheduleId: string }) {
  const [state, action, pending] = useActionState(bookClass, INIT);
  if (state.ok) {
    return (
      <div className="gf-btn gf-btn-full gf-btn-lg" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)', cursor: 'default', justifyContent: 'center' }} role="status">
        {state.waitlisted ? 'Added to waitlist' : 'You’re booked ✓'}
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <button className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" disabled={pending} type="submit">
        {pending ? 'Booking…' : <><Plus size={18} strokeWidth={2.4} /> Book your spot</>}
      </button>
      {state.error && <p className="bk-err" role="alert" style={{ marginTop: 8, textAlign: 'center' }}>{state.error}</p>}
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
