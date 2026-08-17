import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Pure two-factor primitives: code generation, normalisation and hashing.
//
// Deliberately free of `server-only` and of any database import so the rules
// that decide whether a code is accepted are unit-testable without a Supabase
// project — the same split as lib/email/columns.ts. Everything that touches
// rows lives in lib/auth/two-factor.ts.

/** How long an emailed code stays valid. Long enough to switch to a mail app
 *  on a phone, short enough that a code read over someone's shoulder rots. */
export const CODE_TTL_SECONDS = 600; // 10 minutes

/** Guesses allowed per challenge before it is burned. 5 tries against a
 *  6-digit space is a 1-in-200,000 chance, and the challenge dies either way. */
export const MAX_ATTEMPTS = 5;

/** How long "trust this device" lasts. */
export const TRUST_DAYS = 30;

/** A 6-digit code, zero-padded. randomInt is the CSPRNG — Math.random would
 *  make codes predictable from a couple of observed samples. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Opaque token for the trusted-device cookie. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * What the user typed, reduced to comparable form.
 *
 * People paste "123 456", "123-456" or a code with a stray space from the
 * email. Strip everything that isn't a digit rather than rejecting input a
 * human would call correct.
 */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 6);
}

export function isWellFormedCode(raw: string | null | undefined): boolean {
  return normalizeCode(raw).length === 6;
}

/**
 * sha256(challengeId || code).
 *
 * Salting with the challenge id means the stored hash is useless without the
 * id — which lives only in the caller's httpOnly cookie — and that two
 * challenges issuing the same 6 digits don't share a hash. A slow KDF would be
 * overkill here: the code is single-use, dies in 10 minutes and survives 5
 * guesses.
 */
export function hashCode(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${normalizeCode(code)}`).digest('hex');
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time hash comparison — a length-safe wrapper over timingSafeEqual,
 *  which throws on mismatched buffer lengths. */
export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type ChallengeRow = {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
};

export type ChallengeVerdict =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'consumed' | 'locked' | 'mismatch' };

/**
 * Should this code be accepted?
 *
 * Order matters: expiry and consumption are checked before the code is
 * compared, so a burned challenge can't be used as an oracle for guessing.
 * `now` is injected rather than read from the clock so the rules are testable.
 */
export function judgeChallenge(row: ChallengeRow, code: string, now: Date): ChallengeVerdict {
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (!hashesMatch(row.code_hash, hashCode(row.id, code))) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/** The message shown for a failed verdict. Deliberately vague about WHY a code
 *  is wrong (mismatch vs locked reveal different things to an attacker) while
 *  still telling a real user what to do next. */
export function verdictMessage(reason: Exclude<ChallengeVerdict, { ok: true }>['reason']): string {
  switch (reason) {
    case 'expired':
      return 'That code has expired. Send a new one and try again.';
    case 'consumed':
      return 'That code has already been used. Send a new one.';
    case 'locked':
      return 'Too many incorrect attempts. Send a new code and try again.';
    default:
      return 'That code isn’t right. Check the email and try again.';
  }
}

/**
 * Coarse device label for the trusted-device list ("Chrome on Windows").
 *
 * Stores a recognisable name, not the raw user-agent: the full string is a
 * fingerprint, and this row only needs to be identifiable by the human
 * revoking it.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'device';
  return `${browser} on ${os}`;
}

// ── Platform-admin second factor: the temporary off switch ────────────────
//
// Platform admins are otherwise unconditionally challenged (see
// twoFactorRequiredForUser). This is the one way out, and it is an env var
// rather than a column or a UI toggle on purpose: it should take a deploy to
// change, leave a trace in the deployment log, and be impossible to flip from
// inside the product — including by whoever holds the console account.
//
// Fail-secure. Only an explicit, unambiguous "off" disables the requirement;
// unset, empty, or anything unrecognised reads as ON. A typo in this variable
// must not silently strip the second factor from the account that reads every
// tenant's members, payments and payout details.
const TWO_FACTOR_OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled']);

export function platformAdminTwoFactorDisabled(raw: string | null | undefined): boolean {
  return TWO_FACTOR_OFF_VALUES.has((raw ?? '').trim().toLowerCase());
}
