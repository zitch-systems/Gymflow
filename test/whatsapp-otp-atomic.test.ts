import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const EMAIL = 'membera@example.com';
const WA_ID = '2348031234567';
const GOOD_HASH = 'a'.repeat(64);
const WRONG_HASH = 'b'.repeat(64);

type Result = {
  status: string;
  otp_id: string | null;
  user_id: string | null;
  gym_id: string | null;
  attempts_remaining: number;
};

beforeEach(async () => {
  await seed();
  await asSuperuser((c) => c.query(`delete from public.whatsapp_email_otps where email = $1`, [EMAIL]));
});

async function issue(over: { waId?: string; hash?: string; attempts?: number; expired?: boolean; userId?: string | null; gymId?: string | null } = {}) {
  await asSuperuser((c) => c.query(
    `insert into public.whatsapp_email_otps
       (email, code_hash, purpose, user_id, gym_id, wa_id, attempts, expires_at)
     values ($1, $2, 'signup', $3, $4, $5, $6, now() + $7::interval)`,
    [
      EMAIL, over.hash ?? GOOD_HASH,
      over.userId === undefined ? IDS.memberA : over.userId,
      over.gymId === undefined ? IDS.gymA : over.gymId,
      over.waId ?? WA_ID, over.attempts ?? 0,
      over.expired ? '-1 minute' : '15 minutes',
    ],
  ));
}

async function consume(hash = GOOD_HASH, waId = WA_ID): Promise<Result> {
  return withSession({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<Result>(
      `select * from public.consume_whatsapp_email_otp($1, $2, $3, 5)`,
      [EMAIL, waId, hash],
    );
    return rows[0];
  });
}

describe('atomic WhatsApp signup OTP consumption', () => {
  it('binds the challenge to the WhatsApp identity without spending its attempts', async () => {
    await issue();
    expect((await consume(GOOD_HASH, '2348099999999')).status).toBe('missing');
    const row = await asSuperuser((c) => c.query(
      `select attempts, consumed_at from public.whatsapp_email_otps where email = $1`, [EMAIL],
    ));
    expect(row.rows[0]).toMatchObject({ attempts: 0, consumed_at: null });
  });

  it('counts failures and burns the row exactly at the limit', async () => {
    await issue();
    for (const remaining of [4, 3, 2, 1]) {
      expect(await consume(WRONG_HASH)).toMatchObject({ status: 'mismatch', attempts_remaining: remaining });
    }
    expect(await consume(WRONG_HASH)).toMatchObject({ status: 'locked', attempts_remaining: 0 });
    expect((await consume(GOOD_HASH)).status).toBe('missing');
  });

  it('returns identity only for a successful, complete challenge', async () => {
    await issue();
    expect(await consume()).toMatchObject({
      status: 'matched', user_id: IDS.memberA, gym_id: IDS.gymA,
    });
    await issue({ userId: null });
    expect(await consume()).toMatchObject({
      status: 'invalid_identity', user_id: null, gym_id: null,
    });
  });

  it('allows only one winner when the same code is submitted concurrently', async () => {
    await issue();
    const results = await Promise.all([consume(), consume()]);
    expect(results.map((r) => r.status).sort()).toEqual(['matched', 'missing']);
    expect(results.filter((r) => r.user_id)).toHaveLength(1);
  });

  it('serializes concurrent wrong guesses at the attempt ceiling', async () => {
    await issue();
    const results = await Promise.all(Array.from({ length: 6 }, () => consume(WRONG_HASH)));
    expect(results.map((r) => r.status).sort()).toEqual([
      'locked', 'mismatch', 'mismatch', 'mismatch', 'mismatch', 'missing',
    ]);
    const row = await asSuperuser((c) => c.query(
      `select attempts, consumed_at is not null as consumed
       from public.whatsapp_email_otps where email = $1`,
      [EMAIL],
    ));
    expect(row.rows[0]).toEqual({ attempts: 5, consumed: true });
  });

  it('consumes expired codes and denies replay', async () => {
    await issue({ expired: true });
    expect((await consume()).status).toBe('expired');
    expect((await consume()).status).toBe('missing');
  });

  it('cannot be called by an authenticated browser role', async () => {
    await issue();
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) =>
      c.query(`select * from public.consume_whatsapp_email_otp($1, $2, $3, 5)`, [EMAIL, WA_ID, GOOD_HASH]),
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('the application provisions only after the atomic RPC returns matched', () => {
    const src = readFileSync(resolve(__dirname, '..', 'lib/whatsapp/auth.ts'), 'utf8');
    const verify = src.slice(src.indexOf('export async function verifyEmailOtp'), src.indexOf('export async function signinWithPassword'));
    expect(verify).toContain("otp.status !== 'matched'");
    expect(verify.indexOf("otp.status !== 'matched'")).toBeLessThan(verify.indexOf('provisionMember({'));
    expect(verify).not.toContain(".from('whatsapp_email_otps')");
  });
});
