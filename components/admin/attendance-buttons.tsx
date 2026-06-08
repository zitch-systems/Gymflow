'use client';

import { useActionState } from 'react';
import { setBookingStatus, type CState } from '@/lib/actions/admin-class';

const INIT: CState = { ok: false, error: null };

export function AttendanceButtons({ bookingId, scheduleId, status }: { bookingId: string; scheduleId: string; status: string }) {
  const [, action, pending] = useActionState(setBookingStatus, INIT);
  if (status === 'cancelled') return <span className="gf-badge">Cancelled</span>;
  return (
    <form action={action} className="att">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <button name="status" value="attended" className={`att-btn ok${status === 'attended' ? ' on' : ''}`} disabled={pending} type="submit">Attended</button>
      <button name="status" value="no_show" className={`att-btn no${status === 'no_show' ? ' on' : ''}`} disabled={pending} type="submit">No-show</button>
    </form>
  );
}
