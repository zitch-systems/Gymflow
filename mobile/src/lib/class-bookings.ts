import type { Booking, Slot } from '@/api/types';

/** A reservation belongs to a dated occurrence, not every week of a slot. */
export function bookingForSlot(slot: Pick<Slot, 'id' | 'next_date'>, bookings: Booking[]): Booking | undefined {
  return bookings.find((booking) => booking.class_schedule_id === slot.id
    && booking.booking_date === slot.next_date
    && (booking.status === 'booked' || booking.status === 'waitlisted'));
}

export function canCancelBooking(booking: Booking, today: string): boolean {
  return (booking.status === 'booked' || booking.status === 'waitlisted')
    && Boolean(booking.booking_date && booking.booking_date >= today);
}
