import type { SupabaseClient } from '@supabase/supabase-js';
import { isOfflineGym } from '@/lib/gym-status';
import { watDateISO, watDayStartUtc } from '@/lib/format';

// Door logic for a member: are they allowed in, are they already inside, and
// what happens when they tap check in / check out / "give me a front-desk code".
//
// This lives apart from lib/actions/checkin.ts because two clients need the
// same answers. The web PWA calls the Server Actions (cookie session); the
// Android app calls /api/app/checkin (bearer token). Both hand a Supabase
// client that is already scoped to the member — RLS is the authority either
// way — so everything here is written against (supabase, memberId, gym) and
// knows nothing about how the caller was authenticated.
//
// Keeping one copy matters more here than almost anywhere else in the app: this
// is the code that decides whether an unpaid membership opens the door. A
// second implementation behind the mobile endpoints would be a second place for
// that gate to drift.

/* eslint-disable @typescript-eslint/no-explicit-any */
// The generated Database types don't cover every column these tables have grown
// (see the casts in lib/actions/*.ts for the same reason), and this module is
// called with clients typed both ways — from the SSR client and from the
// mobile API's token client. A loose client type here keeps one implementation.
type Sb = SupabaseClient<any, any, any>;

export type CheckinResult = { ok: true; daysLeft: number | null } | { ok: false; error: string };
export type CheckoutResult = { ok: true } | { ok: false; error: string };
export type CodeResult = { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

type GymRef = { id: string; status?: string | null };

// How long a front-desk code stays redeemable. Long enough to survive a short
// reception queue, short enough that a shouted code doesn't linger.
export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * The member's open visit today (WAT): checked in, not yet checked out. This is
 * the row check-out closes, and its presence is what flips the UI to "check out".
 */
export async function openVisit(supabase: Sb, gymId: string, memberId: string) {
  const { data } = await supabase
    .from('check_ins').select('id, checked_in_at')
    .eq('member_id', memberId).eq('gym_id', gymId)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()))
    .order('checked_in_at', { ascending: false })
    .limit(1).maybeSingle();
  return data as { id: string; checked_in_at: string | null } | null;
}

// Is this member's link at the gym suspended? Staff can switch a member off
// without deleting them; that member doesn't get through the door.
async function linkSuspended(supabase: Sb, gymId: string, memberId: string): Promise<boolean> {
  const { data: link } = await supabase
    .from('gym_member_links').select('is_active')
    .eq('gym_id', gymId).or(`member_id.eq.${memberId},user_id.eq.${memberId}`)
    .maybeSingle();
  return Boolean(link) && (link as { is_active: boolean | null }).is_active === false;
}

/**
 * The member's current subscription, if it still entitles them to enter.
 *
 * past_due counts as access while the paid period hasn't run out (end_date >=
 * today) — the same grace window the dashboard honours. A truly lapsed sub
 * (end_date < today) returns null. "Today" is WAT, the gym's local day, not the
 * UTC server day.
 */
async function currentEntitlement(supabase: Sb, gymId: string, memberId: string): Promise<{ endDate: string | null } | null> {
  const todayStr = watDateISO();
  const { data: sub } = await supabase
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', memberId).eq('gym_id', gymId).in('status', ['active', 'past_due'])
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  const row = sub as { end_date: string | null } | null;
  if (!row || (row.end_date ?? '') < todayStr) return null;
  return { endDate: row.end_date };
}

function daysLeftOf(endDate: string | null): number | null {
  return endDate ? Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000)) : null;
}

/**
 * Self check-in — inserts a check_in row for the member at their gym.
 *
 * Entry requires a non-suspended membership link AND a current subscription;
 * repeat taps while already inside are de-duplicated (a member already inside
 * isn't logged twice), but a visit closed by check-out earlier today doesn't
 * block re-entry.
 */
export async function checkInCore(supabase: Sb, memberId: string, gym: GymRef): Promise<CheckinResult> {
  // A gym GymFlow has switched off isn't open. Checked before the member's own
  // membership state: whose fault it is doesn't change the answer at the door,
  // and the member-facing wording shouldn't blame them for it.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not open on GymFlow right now. Please see the front desk.' };
  }

  if (await linkSuspended(supabase, gym.id, memberId)) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  const entitlement = await currentEntitlement(supabase, gym.id, memberId);
  if (!entitlement) return { ok: false, error: 'Your membership isn’t active. Renew to check in.' };
  const daysLeft = daysLeftOf(entitlement.endDate);

  // Already inside? Treat a repeat as success without a dup row.
  const existing = await openVisit(supabase, gym.id, memberId);
  if (existing) return { ok: true, daysLeft };

  const { error } = await supabase.from('check_ins').insert({
    member_id: memberId,
    gym_id: gym.id,
    check_in_method: 'self',
    checked_in_at: new Date().toISOString(),
    status: 'active',
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, daysLeft };
}

/**
 * Self check-out — closes the member's open visit for today. The row gains
 * checked_out_at and flips to 'completed', which is what the dashboard's
 * avg-session stat and the admin duration column read.
 */
export async function checkOutCore(supabase: Sb, memberId: string, gymId: string): Promise<CheckoutResult> {
  const open = await openVisit(supabase, gymId, memberId);
  if (!open) return { ok: false, error: 'You’re not checked in right now.' };

  const { error } = await supabase.from('check_ins')
    .update({ checked_out_at: new Date().toISOString(), status: 'completed' })
    .eq('id', open.id).is('checked_out_at', null);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Front-desk code — a short-lived, single-use 6-digit code the member reads out
 * to reception instead of scanning. Staff key it into /admin/staff-checkin,
 * which checks the member in — or out if they're already inside.
 */
export async function generateCodeCore(supabase: Sb, memberId: string, gym: GymRef): Promise<CodeResult> {
  // Same door, same answer — see checkInCore.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not open on GymFlow right now. Please see the front desk.' };
  }

  if (await linkSuspended(supabase, gym.id, memberId)) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  // Require a current subscription to generate a code — the same gate check-in
  // enforces, or reception could be talked into opening the door for an unpaid
  // membership. Members already inside can still check OUT: an open visit today
  // keeps code generation available so they aren't trapped.
  const openToday = await openVisit(supabase, gym.id, memberId);
  if (!openToday && !(await currentEntitlement(supabase, gym.id, memberId))) {
    return { ok: false, error: 'Your membership isn’t active. Renew to check in.' };
  }

  // One live code per member — void previous ones so reception can never be
  // holding two working codes for the same person.
  await supabase.from('checkin_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('member_id', memberId).eq('gym_id', gym.id).is('used_at', null);

  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  // Random 6 digits. The partial unique index on (gym_id, code) where unused
  // rejects a clash with another member's live code — just re-roll.
  for (let attempt = 0; attempt < 5; attempt++) {
    const buf = new Uint32Array(1);
    (globalThis.crypto as Crypto).getRandomValues(buf);
    const code = String(buf[0] % 1_000_000).padStart(6, '0');
    const { error } = await supabase.from('checkin_codes').insert({
      gym_id: gym.id, member_id: memberId, code, expires_at: expiresAt,
    });
    if (!error) return { ok: true, code, expiresAt };
    if ((error as { code?: string }).code !== '23505') return { ok: false, error: error.message };
  }
  return { ok: false, error: 'Couldn’t generate a code. Please try again.' };
}
