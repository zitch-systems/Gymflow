'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { bookClassCore, cancelBookingCore, type BookState } from '@/lib/booking-core';

export type { BookState };

// Web (cookie-session) entry points for class bookings. Capacity, waitlisting
// and waitlist promotion live in lib/booking-core.ts so the Android app's
// /api/app/classes endpoint books against exactly the same rules — two
// implementations of "is this class full?" is two members in one seat.
//
// These wrappers own the parts the core can't: the useActionState signature the
// forms bind to, resolving the member from cookies, and cache invalidation.

export async function bookClass(_prev: BookState, formData: FormData): Promise<BookState> {
  const scheduleId = String(formData.get('scheduleId') ?? '');
  try {
    const { user, gym } = await requireMember();
    const supabase = await createClient();
    const res = await bookClassCore(supabase, user.id, gym, scheduleId);
    if (res.ok) { revalidatePath('/classes'); revalidatePath('/dashboard'); }
    return res;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cancelBooking(_prev: BookState, formData: FormData): Promise<BookState> {
  const bookingId = String(formData.get('bookingId') ?? '');
  try {
    const { user } = await requireMember();
    const supabase = await createClient();
    const res = await cancelBookingCore(supabase, user.id, bookingId);
    if (res.ok) { revalidatePath('/classes'); revalidatePath('/dashboard'); }
    return res;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
