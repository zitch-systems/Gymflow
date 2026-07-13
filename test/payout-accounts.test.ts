import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// gym_payout_accounts (20260713_gym_payout_accounts.sql): multiple payout
// accounts per gym with exactly one active, managed self-service by the gym's
// own owner/manager. Covers:
//   - owner/manager of the gym can insert their own accounts (RLS allow)
//   - the partial unique index enforces at most ONE active account per gym
//   - many INACTIVE accounts are allowed alongside the single active one
//   - a plain member cannot write, and another gym's owner cannot read or
//     write this gym's accounts (tenant isolation)

async function countFor(gymId: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ total: string; active: string }>(
      `select count(*)::int total, count(*) filter (where is_active)::int active
         from public.gym_payout_accounts where gym_id = $1`, [gymId]);
    return { total: Number(rows[0].total), active: Number(rows[0].active) };
  });
}

const INSERT = `insert into public.gym_payout_accounts
  (gym_id, bank_name, bank_code, account_number, account_name, is_active)
  values ($1, $2, $3, $4, $5, $6)`;

describe('gym_payout_accounts', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.gym_payout_accounts`));
  });

  it('gym owner can add a payout account for their own gym', async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const { rowCount } = await c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0123456789', 'Gym A', true]);
      expect(rowCount).toBe(1);
    });
    expect(await countFor(IDS.gymA)).toEqual({ total: 1, active: 1 });
  });

  it('enforces at most one ACTIVE account per gym (partial unique index)', async () => {
    await asSuperuser((c) => c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0000000001', 'A', true]));
    await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      await expect(
        c.query(INSERT, [IDS.gymA, 'UBA', '033', '0000000002', 'B', true]),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it('allows many inactive accounts alongside the single active one', async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      await c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0000000001', 'A', true]);
      await c.query(INSERT, [IDS.gymA, 'UBA', '033', '0000000002', 'B', false]);
      await c.query(INSERT, [IDS.gymA, 'Zenith', '057', '0000000003', 'C', false]);
    });
    expect(await countFor(IDS.gymA)).toEqual({ total: 3, active: 1 });
  });

  it('a plain member cannot add a payout account', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await expect(
        c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0123456789', 'X', true]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("another gym's owner cannot add an account to this gym", async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      await expect(
        c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0123456789', 'X', true]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("another gym's owner cannot read this gym's accounts (tenant isolation)", async () => {
    await asSuperuser((c) => c.query(INSERT, [IDS.gymA, 'GTBank', '058', '0000000009', 'A', true]));
    await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      const { rows } = await c.query(`select id from public.gym_payout_accounts where gym_id = $1`, [IDS.gymA]);
      expect(rows).toHaveLength(0);
    });
  });
});
