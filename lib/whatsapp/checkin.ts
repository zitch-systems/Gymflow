import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { numericCode } from '@/lib/crypto/secret-box';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { isOfflineGym } from '@/lib/gym-status';
import { membershipSnapshot } from '@/lib/whatsapp/membership';
import type { WhatsAppGym } from '@/lib/whatsapp/settings';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// Check-in and check-out from WhatsApp.
//
// SYNCED, NOT PARALLEL. This module deliberately owns no state of its own. It
// writes `check_ins` rows and `checkin_codes` rows — the exact same tables the
// member app and the front desk already use — so:
//
//   • a code generated in WhatsApp is redeemed at /admin/staff-checkin by the
//     same query that redeems a code generated in the app; reception cannot
//     tell them apart and does not need to;
//   • a WhatsApp check-in closes with a check-out in the app, and vice versa,
//     because both are the same open visit row;
//   • visit history, the "who is inside now" KPI, and average-session stats
//     count WhatsApp visits without any change to how they are computed.
//
// The app's own QR path (/checkin?via=qr) is not touched by any of this.
//
// The eligibility rules mirror lib/actions/checkin.ts exactly — suspended
// members are refused, an active OR past-due-but-unexpired subscription is
// required, and a repeat check-in while already inside is a no-op rather than a
// duplicate row. Two doors into one building should not have two different
// locks.

const CODE_TTL_MS = 10 * 60 * 1000;

export type CheckinOutcome =
  | { ok: true; action: 'checked_in' | 'checked_out' | 'already_in'; daysRemaining: number | null }
  | { ok: false; error: string };

export type CodeOutcome = { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

/** The member's open visit today, in gym-local (WAT) terms. */
async function openVisit(admin: Admin, gymId: string, memberId: string) {
  const { data } = await admin
    .from('check_ins')
    .select('id, checked_in_at')
    .eq('member_id', memberId).eq('gym_id', gymId)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()))
    .order('checked_in_at', { ascending: false })
    .limit(1).maybeSingle();
  return data as { id: string; checked_in_at: string | null } | null;
}

/**
 * Shared gate for every entry path here.
 *
 * `allowWhenInside` exists because a member who is already inside must always
 * be able to check OUT, even if their subscription lapsed while they were
 * training. Trapping someone in the building over a billing state would be
 * absurd.
 */
async function eligibility(
  admin: Admin,
  gym: WhatsAppGym,
  memberId: string,
  opts: { allowWhenInside?: boolean } = {},
): Promise<{ ok: true; daysRemaining: number | null } | { ok: false; error: string }> {
  if (isOfflineGym(gym)) {
    return { ok: false, error: `${gym.name} is not open on GymFlow right now. Please see the front desk.` };
  }

  const { data: link } = await admin
    .from('gym_member_links').select('is_active')
    .eq('gym_id', gym.id).or(`member_id.eq.${memberId},user_id.eq.${memberId}`)
    .maybeSingle();
  if (link && (link as { is_active: boolean | null }).is_active === false) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  if (opts.allowWhenInside && (await openVisit(admin, gym.id, memberId))) {
    return { ok: true, daysRemaining: null };
  }

  const snap = await membershipSnapshot(admin, memberId, gym.id);
  if (!snap.active) {
    return { ok: false, error: 'Your membership isn’t active. Reply RENEW to sort it out.' };
  }
  return { ok: true, daysRemaining: snap.daysRemaining };
}

/**
 * Toggle: check in, or check out if already inside.
 *
 * One entry point rather than two because that is how the member thinks about
 * it — they scanned the door, and what should happen depends on whether they
 * are arriving or leaving, not on which command they remembered.
 */
export async function whatsappCheckToggle(
  admin: Admin,
  params: { gym: WhatsAppGym; memberId: string; method?: string },
): Promise<CheckinOutcome> {
  const open = await openVisit(admin, params.gym.id, params.memberId);

  if (open) {
    const { error } = await admin
      .from('check_ins')
      .update({ checked_out_at: new Date().toISOString(), status: 'completed' })
      .eq('id', open.id).is('checked_out_at', null);
    if (error) return { ok: false, error: 'Check-out didn’t go through. Please see the front desk.' };
    return { ok: true, action: 'checked_out', daysRemaining: null };
  }

  const gate = await eligibility(admin, params.gym, params.memberId);
  if (!gate.ok) return gate;

  const { error } = await admin.from('check_ins').insert({
    member_id: params.memberId,
    gym_id: params.gym.id,
    check_in_method: params.method ?? 'whatsapp',
    checked_in_at: new Date().toISOString(),
    status: 'active',
  });
  if (error) return { ok: false, error: 'Check-in didn’t go through. Please see the front desk.' };

  return { ok: true, action: 'checked_in', daysRemaining: gate.daysRemaining };
}

/**
 * A six-digit code to read out at reception.
 *
 * Identical in every respect to the one the member app produces — same table,
 * same TTL, same single-live-code rule, same partial unique index handling —
 * except that `source` records it came from WhatsApp. Reception's redeem screen
 * needs no change at all.
 */
export async function whatsappCheckinCode(
  admin: Admin,
  params: { gym: WhatsAppGym; memberId: string },
): Promise<CodeOutcome> {
  // allowWhenInside: a member already inside is asking for a code to check OUT.
  const gate = await eligibility(admin, params.gym, params.memberId, { allowWhenInside: true });
  if (!gate.ok) return gate;

  // Void any live code first, so reception can never hold two working codes for
  // the same person.
  await admin.from('checkin_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('member_id', params.memberId).eq('gym_id', params.gym.id).is('used_at', null);

  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = numericCode(6);
    const { error } = await admin.from('checkin_codes').insert({
      gym_id: params.gym.id, member_id: params.memberId, code, expires_at: expiresAt, source: 'whatsapp',
    });
    if (!error) return { ok: true, code, expiresAt };
    // 23505 is the partial unique index rejecting a clash with another member's
    // live code — just draw again.
    if (error.code !== '23505') return { ok: false, error: 'Couldn’t generate a code. Please try again.' };
  }
  return { ok: false, error: 'Couldn’t generate a code. Please try again.' };
}

// ── Door QR ────────────────────────────────────────────────────────────────
//
// The gym prints a QR that encodes a wa.me link with prefilled text. A member
// points their phone camera at it, WhatsApp opens with the message ready, they
// send it, and they are in. No app, no login, no typing.
//
// The token is an HMAC over the gym id. That stops someone checking into an
// arbitrary gym by typing a guessed command, but it is a STATIC secret printed
// on a wall, so it does not stop a member sending the same text again from
// home. That is the same trust model the app's door QR already has — the URL
// behind it is equally re-visitable — and it is why the printed sign is a
// convenience for members rather than an access-control mechanism. Gyms that
// want entry actually enforced use the front-desk code path, where a human is
// looking at the person. A per-gym `qr_checkin_enabled` switch turns the QR
// path off for gyms that prefer that.

const QR_PREFIX = 'CHECKIN';

function qrSecret(): string | null {
  return process.env.WHATSAPP_QR_SECRET || process.env.SECRETS_ENCRYPTION_KEY || null;
}

export function signGymQrToken(gymId: string): string | null {
  const secret = qrSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(`whatsapp-checkin:${gymId}`).digest('base64url').slice(0, 22);
}

export function verifyGymQrToken(gymId: string, token: string): boolean {
  const expected = signGymQrToken(gymId);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The message body the printed QR puts in the member's compose box. */
export function qrMessageBody(gym: Pick<WhatsAppGym, 'slug' | 'id'>): string | null {
  const token = signGymQrToken(gym.id);
  return token ? `${QR_PREFIX} ${gym.slug} ${token}` : null;
}

/** The full wa.me URL a door QR encodes. */
export function qrDeepLink(gym: Pick<WhatsAppGym, 'slug' | 'id'>, businessNumber: string): string | null {
  const body = qrMessageBody(gym);
  if (!body) return null;
  return `https://wa.me/${businessNumber.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`;
}

export type ParsedQr = { slug: string; token: string };

/** Recognise an inbound door-QR message. Case-insensitive; tolerates extra spaces. */
export function parseQrMessage(text: string): ParsedQr | null {
  const m = /^\s*CHECKIN\s+([a-z0-9-]{2,64})\s+([A-Za-z0-9_-]{10,64})\s*$/i.exec(text);
  return m ? { slug: m[1].toLowerCase(), token: m[2] } : null;
}
