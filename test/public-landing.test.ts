import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Anon (signed-out) reads that the gym landing page depends on. After the
// tenant-isolation hardening (20260731), gyms and membership_plans are no
// longer accessible to anon — only classes and business_hours remain public.

const INACTIVE_PLAN = 'e1111111-1111-1111-1111-11111111aaaa';
const ACTIVE_CLASS = 'e2222222-2222-2222-2222-22222222bbbb';
const INACTIVE_CLASS = 'e2222222-2222-2222-2222-22222222cccc';

describe('public landing reads (anon fallback)', () => {
  beforeAll(async () => {
    await seed();
    await asSuperuser(async (c) => {
      await c.query(
        `insert into public.membership_plans (id, gym_id, name, duration_months, price, is_active)
         values ($1, $2, 'Retired plan', 1, 5000, false) on conflict (id) do nothing`,
        [INACTIVE_PLAN, IDS.gymA],
      );
      await c.query(
        `insert into public.classes (id, gym_id, name, is_active) values
           ($1, $3, 'Yoga', true), ($2, $3, 'Retired class', false)
         on conflict (id) do nothing`,
        [ACTIVE_CLASS, INACTIVE_CLASS, IDS.gymA],
      );
      await c.query(
        `insert into public.business_hours (gym_id, day_of_week, open_time, close_time, is_closed)
         values ($1, 1, '06:00', '22:00', false) on conflict do nothing`,
        [IDS.gymA],
      );
    });
  });

  it('anon cannot read gyms (hardened in tenant isolation)', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      await expect(
        c.query(`select id from public.gyms where id = $1`, [IDS.gymA]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it('anon cannot read membership plans (hardened in tenant isolation)', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      await expect(
        c.query(`select id from public.membership_plans where gym_id = $1`, [IDS.gymA]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it('authenticated member can still read gyms', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rows } = await c.query(`select id from public.gyms where id = $1`, [IDS.gymA]);
      expect(rows).toHaveLength(1);
    });
  });

  it('anon sees active classes but not inactive ones', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query(
        `select id from public.classes where gym_id = $1`, [IDS.gymA]);
      expect(rows.some((r) => r.id === ACTIVE_CLASS)).toBe(true);
      expect(rows.some((r) => r.id === INACTIVE_CLASS)).toBe(false);
    });
  });

  it('anon can read business hours', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query(
        `select day_of_week from public.business_hours where gym_id = $1`, [IDS.gymA]);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it('anon cannot write classes', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      await expect(c.query(
        `insert into public.classes (gym_id, name, is_active) values ($1, 'Hacked', true)`,
        [IDS.gymA],
      )).rejects.toThrow(/row-level security|permission denied/i);
    });
  });
});
