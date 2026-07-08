'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CheckinResult = { ok: true; daysLeft: number | null } | { ok: false; error: string };
export type CheckoutResult = { ok: true } | { ok: false; error: string };
export type CodeResult = { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

// How long a front-desk code stays redeemable. Long enough to survive a short
// reception queue, short enough that a shouted code doesn't linger.
const CODE_TTL_MS = 10 * 60 * 1000;

// The member's open visit today (WAT): checked in, not yet checked out. This is
// the row check-out closes, and its presence is what flips the UI to "check out".
async function openVisit(supabase: SupabaseClient, gymId: string, memberId: string) {
  const { data } = await supabase
    .from('check_ins').select('id, checked_in_at')
    .eq('member_id', memberId).eq('gym_id', gymId)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()))
    .order('checked_in_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

// Self check-in — inserts a check_in row for the signed-in member at their gym.
// Entry requires a non-suspended membership link AND an active, non-expired
// subscription; repeat taps while already inside are de-duplicated (a member
// already inside isn't logged twice), but a visit closed by check-out earlier
// today doesn't block re-entry. RLS scopes every query to the caller.
export async function selfCheckIn(): Promise<CheckinResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check in.' };
  }

  const supabase = await createClient();

  // Suspended members (gym_member_links.is_active = false) can't enter.
  const { data: link } = await supabase
    .from('gym_member_links').select('is_active')
    .eq('gym_id', gym.id).or(`member_id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle();
  if (link && link.is_active === false) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  // Require an active, non-expired subscription to check in. "Today" is anchored
  // to WAT (the gym's local day), not the UTC server day.
  const todayStr = watDateISO();
  const { data: sub } = await supabase
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  if (!sub || (sub.end_date ?? '') < todayStr) {
    return { ok: false, error: 'Your membership isn’t active. Renew to check in.' };
  }
  const daysLeft = sub.end_date ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000)) : null;

  // Already inside? Treat a repeat as success without a dup row.
  const existing = await openVisit(supabase, gym.id, user.id);
  if (existing) { revalidatePath('/dashboard'); return { ok: true, daysLeft }; }

  const { error } = await supabase.from('check_ins').insert({
    member_id: user.id,
    gym_id: gym.id,
    check_in_method: 'self',
    checked_in_at: new Date().toISOString(),
    status: 'active',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard');
  return { ok: true, daysLeft };
}

// Self check-out — closes the member's open visit for today. The row gains
// checked_out_at and flips to 'completed', which is what the dashboard's
// avg-session stat and the admin duration column read.
export async function selfCheckOut(): Promise<CheckoutResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check out.' };
  }

  const supabase = await createClient();
  const open = await openVisit(supabase, gym.id, user.id);
  if (!open) return { ok: false, error: 'You’re not checked in right now.' };

  const { error } = await supabase.from('check_ins')
    .update({ checked_out_at: new Date().toISOString(), status: 'completed' })
    .eq('id', open.id).is('checked_out_at', null);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard');
  return { ok: true };
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
// to reception instead of scanning. Staff key it into /admin/staff-checkin,
// which checks the member in — or out if they're already inside (so no
// subscription gate here; redemption enforces it on the check-in path).
export async function generateCheckinCode(): Promise<CodeResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in first.' };
  }

  const supabase = await createClient();

  // Suspended members can't use the front-desk shortcut either.
  const { data: link } = await supabase
    .from('gym_member_links').select('is_active')
    .eq('gym_id', gym.id).or(`member_id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle();
  if (link && link.is_active === false) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  // One live code per member — void previous ones so reception can never be
  // holding two working codes for the same person.
  await supabase.from('checkin_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('member_id', user.id).eq('gym_id', gym.id).is('used_at', null);

  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  // Random 6 digits. The partial unique index on (gym_id, code) where unused
  // rejects a clash with another member's live code — just re-roll.
  for (let attempt = 0; attempt < 5; attempt++) {
    const buf = new Uint32Array(1);
    (globalThis.crypto as Crypto).getRandomValues(buf);
    const code = String(buf[0] % 1_000_000).padStart(6, '0');
    const { error } = await supabase.from('checkin_codes').insert({
      gym_id: gym.id, member_id: user.id, code, expires_at: expiresAt,
    });
    if (!error) return { ok: true, code, expiresAt };
    if (error.code !== '23505') return { ok: false, error: error.message };
  }
  return { ok: false, error: 'Couldn’t generate a code. Please try again.' };
}
