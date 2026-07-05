import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Instructor payout RLS + state-machine tests, covering the hardening in
// 20260707_payout_rls_hardening.sql:
//   - inserts must be the caller's own row, in a gym where they're an ACTIVE
//     instructor, and must start as 'requested'
//   - only gym_owner/manager of the payout's gym can update, and WITH CHECK
//     stops them relocating the row to another gym
//   - instructors cannot self-promote a payout to 'paid'

const INSTRUCTOR_A = 'd1111111-1111-1111-1111-111111111111';

async function setupInstructor() {
  await asSuperuser(async (c) => {
    await c.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [INSTRUCTOR_A, 'coachA@example.com']);
    await c.query(
      `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
       values ($1, $2, 'instructor', true) on conflict do nothing`,
      [IDS.gymA, INSTRUCTOR_A],
    );
  });
}

async function insertPayout(gymId: string, instructorId: string, status = 'requested'): Promise<string> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.instructor_payouts (gym_id, instructor_id, amount, status, bank_code, bank_name, account_number, account_name)
       values ($1, $2, 5000, $3, '058', 'GTBank', '0123456789', 'Coach A') returning id`,
      [gymId, instructorId, status],
    );
    return rows[0].id;
  });
}

async function payoutState(id: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(`select status, gym_id, paystack_transfer_code from public.instructor_payouts where id = $1`, [id]);
    return rows[0];
  });
}

describe('instructor payouts', () => {
  beforeAll(async () => { await seed(); await setupInstructor(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.instructor_payouts`));
  });

  it('instructor can insert their own payout request in their gym', async () => {
    await withSession({ role: 'authenticated', uid: INSTRUCTOR_A, commit: true }, async (c) => {
      const { rowCount } = await c.query(
        `insert into public.instructor_payouts (gym_id, instructor_id, amount, status)
         values ($1, $2, 1000, 'requested')`,
        [IDS.gymA, INSTRUCTOR_A],
      );
      expect(rowCount).toBe(1);
    });
  });

  it("instructor cannot insert a payout that starts life as 'paid'", async () => {
    await withSession({ role: 'authenticated', uid: INSTRUCTOR_A }, async (c) => {
      await expect(c.query(
        `insert into public.instructor_payouts (gym_id, instructor_id, amount, status)
         values ($1, $2, 1000, 'paid')`,
        [IDS.gymA, INSTRUCTOR_A],
      )).rejects.toThrow(/row-level security/i);
    });
  });

  it('instructor cannot insert a payout against another gym', async () => {
    await withSession({ role: 'authenticated', uid: INSTRUCTOR_A }, async (c) => {
      await expect(c.query(
        `insert into public.instructor_payouts (gym_id, instructor_id, amount, status)
         values ($1, $2, 1000, 'requested')`,
        [IDS.gymB, INSTRUCTOR_A],
      )).rejects.toThrow(/row-level security/i);
    });
  });

  it('a plain member (not instructor) cannot insert payouts at all', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await expect(c.query(
        `insert into public.instructor_payouts (gym_id, instructor_id, amount, status)
         values ($1, $2, 1000, 'requested')`,
        [IDS.gymA, IDS.memberA],
      )).rejects.toThrow(/row-level security/i);
    });
  });

  it("instructor cannot promote their own payout to 'paid' (no instructor UPDATE policy)", async () => {
    const id = await insertPayout(IDS.gymA, INSTRUCTOR_A);
    await withSession({ role: 'authenticated', uid: INSTRUCTOR_A }, async (c) => {
      const { rowCount } = await c.query(`update public.instructor_payouts set status = 'paid' where id = $1`, [id]);
      expect(rowCount).toBe(0);
    });
    expect((await payoutState(id)).status).toBe('requested');
  });

  it('gym owner can reject an open payout', async () => {
    const id = await insertPayout(IDS.gymA, INSTRUCTOR_A);
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const { rowCount } = await c.query(
        `update public.instructor_payouts set status = 'rejected', notes = 'test' where id = $1 and status = 'requested'`,
        [id],
      );
      expect(rowCount).toBe(1);
    });
    expect((await payoutState(id)).status).toBe('rejected');
  });

  it("other gym's owner cannot touch this gym's payout", async () => {
    const id = await insertPayout(IDS.gymA, INSTRUCTOR_A);
    await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      const { rowCount } = await c.query(`update public.instructor_payouts set status = 'rejected' where id = $1`, [id]);
      expect(rowCount).toBe(0);
    });
    expect((await payoutState(id)).status).toBe('requested');
  });

  it('gym owner cannot relocate a payout to another gym (WITH CHECK)', async () => {
    const id = await insertPayout(IDS.gymA, INSTRUCTOR_A);
    await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      await expect(
        c.query(`update public.instructor_payouts set gym_id = $2 where id = $1`, [id, IDS.gymB]),
      ).rejects.toThrow(/row-level security/i);
    });
    expect((await payoutState(id)).gym_id).toBe(IDS.gymA);
  });

  it('pay-now claim is a compare-and-swap: second claimer gets zero rows', async () => {
    const id = await insertPayout(IDS.gymA, INSTRUCTOR_A);
    // First claim wins…
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const { rowCount } = await c.query(
        `update public.instructor_payouts set status = 'approved' where id = $1 and status = 'requested'`, [id],
      );
      expect(rowCount).toBe(1);
    });
    // …the concurrent second claim (same conditional) is a no-op.
    await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rowCount } = await c.query(
        `update public.instructor_payouts set status = 'approved' where id = $1 and status = 'requested'`, [id],
      );
      expect(rowCount).toBe(0);
    });
  });
});
