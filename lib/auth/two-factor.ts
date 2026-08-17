import 'server-only';

import { cookies, headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sendPlatformEmail } from '@/lib/email/send';
import { twoFactorCode as twoFactorCodeEmail } from '@/lib/email/templates/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import {
  CODE_TTL_SECONDS, MAX_ATTEMPTS, TRUST_DAYS,
  type ChallengeRow, deviceLabel, generateCode, generateDeviceToken,
  hashCode, hashDeviceToken, judgeChallenge, platformAdminTwoFactorDisabled, verdictMessage,
} from '@/lib/two-factor';

// Server half of email two-factor for gym staff. The rules live in
// lib/two-factor.ts (pure, unit-tested); this file is the row access, the
// cookies and the send.
//
// `as never` on auth_challenges / trusted_devices: both postdate the generated
// lib/database.types.ts, the same pattern webhook_events uses in the Paystack
// route. Service-role throughout — the tables are RLS-locked with no policies.

const CHALLENGE_COOKIE = 'gf_2fa';
const DEVICE_COOKIE = 'gf_td';

/** Cookies are httpOnly + sameSite=lax so the challenge id and device token
 *  are unreadable from JS and don't ride along on cross-site requests. */
const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export type TwoFactorTarget = { userId: string; email: string; required: boolean };

/**
 * Does this email belong to gym staff whose gym requires a second factor?
 *
 * Runs BEFORE the password is checked so the no-2FA path keeps its single
 * sign-in round-trip. It reveals nothing to the caller — the result only
 * decides which internal branch runs, and both branches answer a wrong
 * password identically.
 *
 * A staff member linked to several gyms is challenged if ANY of them requires
 * it: the stricter gym's policy wins, because the same session reaches both
 * consoles.
 */
export async function twoFactorTargetByEmail(email: string): Promise<TwoFactorTarget | null> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return null; }

  // ilike for case-insensitive matching (addresses are stored as typed), with
  // % and _ escaped: unescaped, a submitted "%@%" would be a wildcard that
  // matches an unrelated account and resolves the wrong user id.
  const pattern = email.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data: profile } = await admin
    .from('profiles').select('id, email').ilike('email', pattern).limit(1).maybeSingle();
  if (!profile?.id) return null;

  const required = await twoFactorRequiredForUser(profile.id);
  return { userId: profile.id, email: profile.email ?? email, required };
}

/** The same question, asked once the user id is known for certain. Used as a
 *  safety net after a no-challenge sign-in in case the email lookup missed. */
export async function twoFactorRequiredForUser(userId: string): Promise<boolean> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return false; }

  // Platform admins need a second factor, and this clause is the only thing
  // that gives them one. The requirement used to be derived purely from
  // gym_staff_links: a platform admin has none, `[].some()` is false, and so
  // the single account that reads every tenant's members, payments and payout
  // details was the one account in the system that could not be covered by 2FA
  // at all. It is not a member of any gym, so no gym's policy could ever reach
  // it. There is no per-gym toggle here on purpose — this one is not the
  // tenants' setting to make.
  //
  // PLATFORM_ADMIN_2FA=off suspends it. That is a real downgrade — it leaves a
  // password as the only thing in front of every tenant's data — so it is
  // deliberately awkward: an env var, changed by a deploy, logged loudly on
  // every check, and unreachable from inside the product. Note the fall-THROUGH
  // rather than an early false: a platform admin who is also gym staff still
  // answers to their gym's policy, which is stricter than nothing.
  const { data: platformAdmin } = await admin
    .from('platform_admins')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (platformAdmin) {
    if (!platformAdminTwoFactorDisabled(process.env.PLATFORM_ADMIN_2FA)) return true;
    console.warn('[two-factor] PLATFORM_ADMIN_2FA is off — platform-admin sign-in is password-only. Unset it to restore the second factor.');
  }

  const { data: links } = await admin
    .from('gym_staff_links')
    .select('gym_id, gyms(two_factor_required)')
    .eq('user_id', userId)
    .eq('is_active', true);

  const rows = (links ?? []) as Array<{ gym_id: string | null; gyms: { two_factor_required?: boolean | null } | null }>;
  // Default to required when the flag is null (a gym row written before the
  // column existed): the secure reading of "unknown" is "yes".
  return rows.some((l) => l.gyms?.two_factor_required !== false);
}

export type IssueResult = { ok: boolean; error?: string };

/**
 * Issue a challenge: create the row, email the code, set the cookie.
 *
 * FAILS CLOSED, unlike every other send in the codebase. Elsewhere a missing
 * RESEND_API_KEY or a suppressed address is a skipped notification; here the
 * message IS the authentication step, so an undelivered code must not become
 * an open door — the challenge row is deleted and the caller stays signed out.
 */
export async function issueChallenge(target: { userId: string; email: string }): Promise<IssueResult> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch {
    return { ok: false, error: 'Two-factor codes can’t be issued right now. Contact support.' };
  }

  // Throttle per account and per IP: each call sends real mail to a real
  // inbox, and an unthrottled resend button is a mail cannon.
  const ip = await clientIp();
  const [userOk, ipOk] = await Promise.all([
    rateLimit(`2fa:user:${target.userId}`, 6, 3600),
    rateLimit(`2fa:ip:${ip}`, 20, 3600),
  ]);
  if (!userOk || !ipOk) return { ok: false, error: 'Too many codes requested. Please wait a while and try again.' };

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

  const { data: row, error } = await admin
    .from('auth_challenges' as never)
    .insert({ user_id: target.userId, email: target.email, code_hash: 'pending', expires_at: expiresAt, ip } as never)
    .select('id')
    .maybeSingle();
  const challengeId = (row as { id?: string } | null)?.id;
  if (error || !challengeId) return { ok: false, error: 'Could not start two-factor verification. Please try again.' };

  // The hash is salted with the id, which only exists after the insert — hence
  // the two-step write rather than a single insert.
  const { error: hashErr } = await admin
    .from('auth_challenges' as never)
    .update({ code_hash: hashCode(challengeId, code) } as never)
    .eq('id', challengeId);
  if (hashErr) {
    await admin.from('auth_challenges' as never).delete().eq('id', challengeId);
    return { ok: false, error: 'Could not start two-factor verification. Please try again.' };
  }

  const sent = await sendPlatformEmail({
    to: target.email,
    ...twoFactorCodeEmail({ code, minutes: Math.round(CODE_TTL_SECONDS / 60), email: target.email }),
    template: 'two_factor_code',
  });
  if (!sent.ok) {
    // Nothing was delivered — retire the challenge so a later guess can't land
    // on a code nobody ever received.
    await admin.from('auth_challenges' as never).delete().eq('id', challengeId);
    return {
      ok: false,
      error: sent.skipped
        ? 'We couldn’t email your sign-in code (email delivery isn’t configured). Contact support.'
        : 'We couldn’t email your sign-in code. Please try again in a moment.',
    };
  }

  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challengeId, { ...COOKIE_BASE, maxAge: CODE_TTL_SECONDS });
  return { ok: true };
}

export type PendingChallenge = { id: string; userId: string; email: string };

/** The challenge this browser is currently answering, if any. */
export async function readPendingChallenge(): Promise<PendingChallenge | null> {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  if (!id) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return null; }
  const { data } = await admin
    .from('auth_challenges' as never)
    .select('id, user_id, email, consumed_at')
    .eq('id', id)
    .maybeSingle();
  const row = data as { id: string; user_id: string; email: string; consumed_at: string | null } | null;
  if (!row || row.consumed_at) return null;
  return { id: row.id, userId: row.user_id, email: row.email };
}

export async function clearPendingChallenge(): Promise<void> {
  const jar = await cookies();
  jar.delete(CHALLENGE_COOKIE);
}

export type VerifyResult = { ok: true; userId: string; email: string } | { ok: false; error: string };

/**
 * Check a submitted code against the pending challenge.
 *
 * A failed attempt is counted before the answer is returned, so guessing is
 * bounded by MAX_ATTEMPTS regardless of how fast the attacker submits.
 */
export async function verifyPendingCode(code: string): Promise<VerifyResult> {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  if (!id) return { ok: false, error: 'Your verification session expired. Sign in again.' };

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch {
    return { ok: false, error: 'Two-factor verification is unavailable right now. Contact support.' };
  }

  const { data } = await admin
    .from('auth_challenges' as never)
    .select('id, user_id, email, code_hash, attempts, expires_at, consumed_at')
    .eq('id', id)
    .maybeSingle();
  const row = data as (ChallengeRow & { user_id: string; email: string }) | null;
  if (!row) return { ok: false, error: 'Your verification session expired. Sign in again.' };

  const verdict = judgeChallenge(row, code, new Date());
  if (!verdict.ok) {
    if (verdict.reason === 'mismatch') {
      await admin.from('auth_challenges' as never).update({ attempts: row.attempts + 1 } as never).eq('id', row.id);
      const left = MAX_ATTEMPTS - (row.attempts + 1);
      return {
        ok: false,
        error: left > 0
          ? `${verdictMessage('mismatch')} ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`
          : verdictMessage('locked'),
      };
    }
    return { ok: false, error: verdictMessage(verdict.reason) };
  }

  // Single-use: burn it before the session is established, so a replay of the
  // same code (or a second tab) can't produce a second session.
  await admin.from('auth_challenges' as never).update({ consumed_at: new Date().toISOString() } as never).eq('id', row.id);
  jar.delete(CHALLENGE_COOKIE);
  return { ok: true, userId: row.user_id, email: row.email };
}

/** Is this browser already trusted for the user? Refreshes last_used_at so an
 *  admin reviewing the list can tell live devices from forgotten ones. */
export async function hasTrustedDevice(userId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(DEVICE_COOKIE)?.value;
  if (!token) return false;

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return false; }
  const { data } = await admin
    .from('trusted_devices' as never)
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('token_hash', hashDeviceToken(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  const row = data as { id: string } | null;
  if (!row) return false;

  await admin.from('trusted_devices' as never).update({ last_used_at: new Date().toISOString() } as never).eq('id', row.id);
  return true;
}

/** Remember this browser for TRUST_DAYS. */
export async function rememberDevice(userId: string): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return; }

  const token = generateDeviceToken();
  const expiresAt = new Date(Date.now() + TRUST_DAYS * 86_400_000).toISOString();
  let label = 'Browser';
  try { label = deviceLabel((await headers()).get('user-agent')); } catch { /* header-less context */ }

  const { error } = await admin
    .from('trusted_devices' as never)
    .insert({ user_id: userId, token_hash: hashDeviceToken(token), label, expires_at: expiresAt } as never);
  if (error) return; // trusting the device is a convenience, never a gate

  const jar = await cookies();
  jar.set(DEVICE_COOKIE, token, { ...COOKIE_BASE, maxAge: TRUST_DAYS * 86_400 });
}

/**
 * Turn a passed challenge into a real session.
 *
 * The password was verified against a cookie-less client, so no session exists
 * yet — deliberately, because a session created before the second factor could
 * be lifted from the browser and used directly against PostgREST, which would
 * make the whole challenge decorative. Instead the service role mints a
 * single-use magic-link token (generateLink does NOT send mail) and the
 * cookie-bound client redeems it, which is the same verifyOtp path
 * /auth/confirm already uses.
 */
export async function establishSession(email: string): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch {
    return { ok: false, error: 'Could not complete sign-in. Contact support.' };
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { ok: false, error: 'Could not complete sign-in. Please try again.' };

  const supabase = await createClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (otpErr) return { ok: false, error: 'Could not complete sign-in. Please try again.' };
  return { ok: true };
}
