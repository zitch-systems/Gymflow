import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';

// Contract tests for public.rate_limit_hit (20260707_rate_limits.sql):
// fixed-window counting, atomic reset on window expiry, and the EXECUTE
// lockdown that keeps anon/authenticated from burning windows via RPC.

async function hit(key: string, max: number, windowSec: number): Promise<boolean> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ ok: boolean }>(
      `select public.rate_limit_hit($1, $2, $3) as ok`, [key, max, windowSec],
    );
    return rows[0].ok;
  });
}

describe('rate_limit_hit', () => {
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.rate_limits`));
  });

  it('allows up to max hits, then blocks', async () => {
    expect(await hit('t:basic', 3, 60)).toBe(true);
    expect(await hit('t:basic', 3, 60)).toBe(true);
    expect(await hit('t:basic', 3, 60)).toBe(true);
    expect(await hit('t:basic', 3, 60)).toBe(false); // 4th in window
    expect(await hit('t:basic', 3, 60)).toBe(false); // still blocked
  });

  it('separate keys have separate windows', async () => {
    expect(await hit('t:a', 1, 60)).toBe(true);
    expect(await hit('t:a', 1, 60)).toBe(false);
    expect(await hit('t:b', 1, 60)).toBe(true); // unaffected by t:a
  });

  it('an expired window resets the count', async () => {
    expect(await hit('t:expire', 1, 60)).toBe(true);
    expect(await hit('t:expire', 1, 60)).toBe(false);
    // Time-travel the window into the past instead of sleeping.
    await asSuperuser((c) => c.query(
      `update public.rate_limits set window_start = now() - interval '2 minutes' where key = 't:expire'`,
    ));
    expect(await hit('t:expire', 1, 60)).toBe(true); // fresh window
    expect(await hit('t:expire', 1, 60)).toBe(false); // and it counts again
  });

  it('anon and authenticated cannot execute the function (RPC lockdown)', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await withSession({ role }, async (c) => {
        await expect(
          c.query(`select public.rate_limit_hit('t:sneak', 100, 60)`),
        ).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it('anon and authenticated cannot read or write the counters table', async () => {
    await asSuperuser((c) => c.query(
      `insert into public.rate_limits (key) values ('t:visible')`,
    ));
    // One statement per session — a failed statement poisons the rest of its
    // transaction, so each denial gets a fresh one.
    for (const role of ['anon', 'authenticated'] as const) {
      await withSession({ role }, async (c) => {
        await expect(c.query(`select * from public.rate_limits`)).rejects.toThrow(/permission denied/i);
      });
      await withSession({ role }, async (c) => {
        await expect(c.query(`delete from public.rate_limits`)).rejects.toThrow(/permission denied/i);
      });
    }
  });
});
