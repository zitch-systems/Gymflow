'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import {
  checkInCore, checkOutCore, generateCodeCore, openVisit,
  type CheckinResult, type CheckoutResult, type CodeResult,
} from '@/lib/checkin-core';

// No `export type { … }` here — see the note in lib/actions/renew.ts. A
// 'use server' file may only export async functions, and Turbopack re-emitted
// the type-only re-export as a real one, killing the module at evaluation.
// Import these from '@/lib/checkin-core'.

// Web (cookie-session) entry points for the door. The rules — who may enter,
// what an open visit is, how a front-desk code is minted — live in
// lib/checkin-core.ts, because the Android app reaches the same door through
// /api/app/checkin with a bearer token. These wrappers do the two things the
// core deliberately doesn't: resolve the caller from cookies, and tell Next
// which cached routes the write invalidated.

// Self check-in — inserts a check_in row for the signed-in member at their gym.
export async function selfCheckIn(): Promise<CheckinResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check in.' };
  }

  const supabase = await createClient();
  const res = await checkInCore(supabase, user.id, gym);
  if (res.ok) revalidatePath('/dashboard');
  return res;
}

// Self check-out — closes the member's open visit for today.
export async function selfCheckOut(): Promise<CheckoutResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check out.' };
  }

  const supabase = await createClient();
  const res = await checkOutCore(supabase, user.id, gym.id);
  if (res.ok) revalidatePath('/dashboard');
  return res;
}

// Is the member currently inside? The check-in page polls this while a
// front-desk code is on screen so the phone flips to "you're in / see you next
// time" the moment reception redeems the code.
export async function checkinState(): Promise<{ checkedIn: boolean }> {
  try {
    const { user, gym } = await requireMember();
    const supabase = await createClient();
    const open = await openVisit(supabase, gym.id, user.id);
    return { checkedIn: Boolean(open) };
  } catch {
    return { checkedIn: false };
  }
}

// Front-desk code — a short-lived, single-use 6-digit code the member reads out
// to reception instead of scanning.
export async function generateCheckinCode(): Promise<CodeResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in first.' };
  }

  const supabase = await createClient();
  return generateCodeCore(supabase, user.id, gym);
}
