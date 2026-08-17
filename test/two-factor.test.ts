import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asSuperuser } from './db';
import {
  CODE_TTL_SECONDS, MAX_ATTEMPTS,
  deviceLabel, generateCode, generateDeviceToken, hashCode, hashDeviceToken,
  hashesMatch, isWellFormedCode, judgeChallenge, normalizeCode,
  platformAdminTwoFactorDisabled, verdictMessage,
} from '@/lib/two-factor';

// The rules that decide whether an emailed second factor is accepted. These
// are the difference between "2FA" and "a form that says 2FA", so each way a
// code can be rejected is asserted rather than assumed.

const CHALLENGE = '11111111-2222-3333-4444-555555555555';
const future = (secs: number) => new Date(Date.now() + secs * 1000).toISOString();
const past = (secs: number) => new Date(Date.now() - secs * 1000).toISOString();

function row(over: Partial<Parameters<typeof judgeChallenge>[0]> = {}) {
  return {
    id: CHALLENGE,
    code_hash: hashCode(CHALLENGE, '123456'),
    attempts: 0,
    expires_at: future(CODE_TTL_SECONDS),
    consumed_at: null,
    ...over,
  };
}

describe('code generation', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('keeps leading zeros rather than emitting a short code', () => {
    // padStart is the whole point: a numeric code would render 42 as "42".
    expect(normalizeCode('000042')).toBe('000042');
    expect(isWellFormedCode('000042')).toBe(true);
  });

  it('produces distinct device tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateDeviceToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('normalisation', () => {
  it('accepts what a human would call the right code', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(normalizeCode('  123456  ')).toBe('123456');
  });

  it('rejects anything that is not six digits', () => {
    expect(isWellFormedCode('12345')).toBe(false);
    expect(isWellFormedCode('')).toBe(false);
    expect(isWellFormedCode(null)).toBe(false);
    expect(isWellFormedCode('abcdef')).toBe(false);
  });
});

describe('hashing', () => {
  it('salts with the challenge id, so the same code hashes differently per challenge', () => {
    expect(hashCode(CHALLENGE, '123456')).not.toBe(hashCode('99999999-2222-3333-4444-555555555555', '123456'));
  });

  it('never stores the code itself', () => {
    expect(hashCode(CHALLENGE, '123456')).not.toContain('123456');
  });

  it('matches regardless of user spacing', () => {
    expect(hashCode(CHALLENGE, '123 456')).toBe(hashCode(CHALLENGE, '123456'));
  });

  it('compares safely across lengths', () => {
    expect(hashesMatch('abc', 'abcd')).toBe(false);
    expect(hashesMatch('abc', 'abc')).toBe(true);
  });

  it('hashes device tokens deterministically', () => {
    const token = generateDeviceToken();
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
    expect(hashDeviceToken(token)).not.toBe(token);
  });
});

describe('judgeChallenge', () => {
  const now = new Date();

  it('accepts the right code', () => {
    expect(judgeChallenge(row(), '123456', now)).toEqual({ ok: true });
  });

  it('rejects the wrong code', () => {
    expect(judgeChallenge(row(), '654321', now)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects an expired challenge', () => {
    expect(judgeChallenge(row({ expires_at: past(1) }), '123456', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a challenge that was already used', () => {
    expect(judgeChallenge(row({ consumed_at: past(5) }), '123456', now)).toEqual({ ok: false, reason: 'consumed' });
  });

  it('locks out after MAX_ATTEMPTS, even with the right code', () => {
    expect(judgeChallenge(row({ attempts: MAX_ATTEMPTS }), '123456', now)).toEqual({ ok: false, reason: 'locked' });
  });

  it('checks expiry and consumption BEFORE the code', () => {
    // Otherwise a burned challenge answers "wrong code" vs "expired"
    // differently and becomes an oracle for guessing.
    expect(judgeChallenge(row({ consumed_at: past(5) }), '000000', now)).toEqual({ ok: false, reason: 'consumed' });
    expect(judgeChallenge(row({ expires_at: past(1) }), '000000', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('does not leak which failure happened in the message shown for a bad code', () => {
    expect(verdictMessage('mismatch')).not.toMatch(/expired|used/i);
  });
});

describe('device labels', () => {
  it('summarises without storing the raw user-agent', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1')).toBe('Safari on iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceLabel(null)).toBe('Browser on device');
  });
});

describe('schema (20260729_gym_two_factor)', () => {
  it('defaults every gym to requiring two-factor', async () => {
    const value = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ column_default: string; is_nullable: string }>(
        `select column_default, is_nullable from information_schema.columns
         where table_schema='public' and table_name='gyms' and column_name='two_factor_required'`,
      );
      return rows[0];
    });
    expect(value?.column_default).toMatch(/true/);
    expect(value?.is_nullable).toBe('NO');
  });

  it('keeps the challenge tables off the PostgREST surface entirely', async () => {
    // Same posture as rate_limits and webhook_events: RLS on, no policies, and
    // no privileges for anon/authenticated. A challenge row readable by a
    // signed-in user would hand them every pending code hash in the platform.
    const grants = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ table_name: string; grantee: string }>(
        `select table_name, grantee from information_schema.role_table_grants
         where table_schema='public' and table_name in ('auth_challenges','trusted_devices')
           and grantee in ('anon','authenticated')`,
      );
      return rows;
    });
    expect(grants).toEqual([]);

    const rls = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname='public' and relname in ('auth_challenges','trusted_devices')`,
      );
      return rows;
    });
    expect(rls).toHaveLength(2);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('enforces one row per device token', async () => {
    await asSuperuser(async (c) => {
      const { rows: [user] } = await c.query<{ id: string }>(
        `insert into auth.users (email) values ('2fa-probe@example.com') returning id`,
      );
      const insert = (hash: string) => c.query(
        `insert into public.trusted_devices (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '30 days')`,
        [user.id, hash],
      );
      await insert('deadbeef');
      await expect(insert('deadbeef')).rejects.toMatchObject({ code: '23505' });
      // auth.users cascade takes the device row with it.
      await c.query(`delete from auth.users where id = $1`, [user.id]);
      const { rows } = await c.query(`select 1 from public.trusted_devices where user_id = $1`, [user.id]);
      expect(rows).toHaveLength(0);
    });
  });
});

// Who the second factor actually covers. Both assertions below are source-level
// because `lib/auth/two-factor.ts` and the mobile route talk to PostgREST with
// the service role, which the throwaway Postgres in these tests does not serve.
// They are still worth having: each one pins a hole that was open in
// production, and the failure mode in both cases is a line quietly going away.
// The temporary off switch for the platform admin's second factor. It reads an
// env var, so the thing worth testing is what counts as "off" — and, much more
// importantly, what doesn't. Anything ambiguous has to mean ON: a typo here
// would silently leave a password as the only thing in front of every tenant's
// data, and nothing about the app would look different.
describe('platformAdminTwoFactorDisabled', () => {
  it('is off only for an explicit, unambiguous value', () => {
    for (const v of ['off', 'OFF', ' off ', 'false', '0', 'no', 'disabled']) {
      expect(platformAdminTwoFactorDisabled(v)).toBe(true);
    }
  });

  it('defaults to ON when unset', () => {
    expect(platformAdminTwoFactorDisabled(undefined)).toBe(false);
    expect(platformAdminTwoFactorDisabled(null)).toBe(false);
    expect(platformAdminTwoFactorDisabled('')).toBe(false);
    expect(platformAdminTwoFactorDisabled('   ')).toBe(false);
  });

  it('reads anything it does not recognise as ON', () => {
    // Fail-secure: "offf", "of", "nope", a pasted comment — none of these are
    // an instruction to remove the second factor, and guessing that they might
    // be is how the guard disappears without anyone deciding it should.
    for (const v of ['offf', 'of', 'nope', 'true', '1', 'on', 'enabled', 'null', 'undefined', 'skip']) {
      expect(platformAdminTwoFactorDisabled(v)).toBe(false);
    }
  });
});

describe('two-factor coverage', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('requires a second factor for platform admins', () => {
    // The requirement used to be derived only from gym_staff_links. A platform
    // admin has none, so `[].some()` was false and the one account that reads
    // every tenant's members, payments and payout details was the only account
    // in the system that could not be covered by 2FA at all.
    const src = read('lib/auth/two-factor.ts');
    const fn = src.slice(src.indexOf('export async function twoFactorRequiredForUser'));
    expect(fn).toContain("from('platform_admins')");
    // Required unless the env switch is explicitly off — that is the ONLY way
    // past this clause, and it lives outside the product by design. Pinned as
    // "negated check, then return true" rather than one literal line, so adding
    // a log line between them doesn't fail a test that isn't about logging.
    expect(fn).toContain('const raw = process.env.PLATFORM_ADMIN_2FA;');
    // Positional rather than one literal line: the clause must read "unless the
    // switch parses as off, return true", and it must do so before the
    // staff-links lookup. Pinning the exact line meant a log statement added
    // between the check and the return failed a test that isn't about logging.
    const gate = fn.indexOf('if (!platformAdminTwoFactorDisabled(raw))');
    expect(gate).toBeGreaterThan(-1);
    const returnsTrue = fn.indexOf('return true;', gate);
    expect(returnsTrue).toBeGreaterThan(gate);
    expect(returnsTrue).toBeLessThan(fn.indexOf("from('gym_staff_links')"));
    // Ahead of the staff-links lookup, or a platform admin who is also staff
    // somewhere would be answered by the gym's toggle instead.
    expect(fn.indexOf("from('platform_admins')")).toBeLessThan(fn.indexOf("from('gym_staff_links')"));
  });

  it('does not let the mobile sign-in endpoint hand out a session that skips it', () => {
    // POST /api/app/signin returns a Supabase session straight from a password
    // and is reachable by any account, not just members — so with no check here
    // it was a blanket bypass of every gym's two_factor_required.
    const src = read('app/api/app/signin/route.ts');
    expect(src).toContain('twoFactorRequiredForUser');
    // The session minted a moment earlier has to be revoked, not just withheld.
    expect(src).toMatch(/signOut\(\{ scope: 'local' \}\)/);
  });
});
