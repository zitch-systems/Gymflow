import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Anon (signed-out) reads that the gym landing page's no-service-key fallback
// depends on (20260714_public_landing_reads.sql). The landing already shows
// gyms/plans/classes/hours to the world; these policies make the anon client
// able to read the same data — active rows only where the flag exists — while
// writes stay locked.

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

  it('anon can read gyms (landing/login/join lookup)', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query(`select id from public.gyms where id = $1`, [IDS.gymA]);
      expect(rows).toHaveLength(1);
    });
  });

  it('anon sees active membership plans but not inactive ones', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query(
        `select id, is_active from public.membership_plans where gym_id = $1`, [IDS.gymA]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.is_active)).toBe(true);
      expect(rows.some((r) => r.id === INACTIVE_PLAN)).toBe(false);
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

  it('anon still cannot write plans or classes', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      const upd = await c.query(
        `update public.membership_plans set price = 1 where gym_id = $1`, [IDS.gymA]);
      expect(upd.rowCount).toBe(0);
      await expect(c.query(
        `insert into public.classes (gym_id, name, is_active) values ($1, 'Hacked', true)`,
        [IDS.gymA],
      )).rejects.toThrow(/row-level security|permission denied/i);
    });
  });
});
