'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { gymCanUse, gymHasFeature, memberLockedMessage } from '@/lib/entitlements';
import { bookClassCore, cancelBookingCore, type BookState } from '@/lib/booking-core';
import { rateLimit } from '@/lib/rate-limit';

// Each book/cancel writes rows AND can fire mail (booking confirmation,
// waitlist promotion). A scripted book/cancel loop was an unbounded email
// amplifier aimed at gym staff and our Resend bill, so cap the round trips a
// single member can drive. Generous enough that no honest member browsing the
// timetable will ever see it.
const BOOKING_RATE = 'Too many booking changes — give it a minute and try again.';

// No `export type { BookState }` here — see the note in lib/actions/renew.ts.
// A 'use server' file may only export async functions, and Turbopack re-emitted
// that type-only re-export as a real one, so the module died on evaluation.
// components/member/class-actions.tsx imports the type from '@/lib/booking-core'.

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
    // Both gates the phone gets in app/api/app/classes/route.ts, in the same
    // order: the member app itself is a Growth surface (gymCanUse — legacy gyms
    // keep it), and class scheduling was Growth-only even before that, so it
    // stays on gymHasFeature. A layout does not run for an action POST.
    if (!gymCanUse(gym, 'member_app')) return { ok: false, error: memberLockedMessage(gym.name, 'the member app') };
    if (!gymHasFeature(gym, 'class_scheduling')) return { ok: false, error: memberLockedMessage(gym.name, 'class booking') };
    if (!(await rateLimit(`book:user:${user.id}`, 30, 60))) return { ok: false, error: BOOKING_RATE };
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
    if (!(await rateLimit(`book:user:${user.id}`, 30, 60))) return { ok: false, error: BOOKING_RATE };
    const supabase = await createClient();
    const res = await cancelBookingCore(supabase, user.id, bookingId);
    if (res.ok) { revalidatePath('/classes'); revalidatePath('/dashboard'); }
    return res;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
