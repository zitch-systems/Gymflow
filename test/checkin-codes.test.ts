import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// RLS tests for the front-desk check-in code flow (20260708 migration):
// members generate a code on /checkin, staff redeem it on /admin/staff-checkin
// to check the member in/out. Also covers the new checkins_update_self policy
// (self check-out).

const CODE_ID = 'd1111111-1111-1111-1111-111111111111';
const VISIT_ID = 'e1111111-1111-1111-1111-111111111111';

// A committed live code for member A at gym A, visible across sessions.
async function seedCode() {
  await asSuperuser(async (c) => {
    await c.query(`delete from public.checkin_codes where id = $1`, [CODE_ID]);
    await c.query(
      `insert into public.checkin_codes (id, gym_id, member_id, code, expires_at)
       values ($1, $2, $3, '123456', now() + interval '10 minutes')`,
      [CODE_ID, IDS.gymA, IDS.memberA],
    );
  });
}

beforeAll(async () => { await seed(); });

describe('checkin_codes RLS', () => {
  it('member can generate a code for themselves at their own gym', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rowCount } = await c.query(
        `insert into public.checkin_codes (gym_id, member_id, code, expires_at)
         values ($1, $2, '654321', now() + interval '10 minutes')`,
        [IDS.gymA, IDS.memberA],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('member cannot mint a code for someone else', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await expect(
        c.query(
          `insert into public.checkin_codes (gym_id, member_id, code, expires_at)
           values ($1, $2, '654321', now() + interval '10 minutes')`,
          [IDS.gymA, IDS.memberB],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('member cannot mint a code at a gym they do not belong to', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await expect(
        c.query(
          `insert into public.checkin_codes (gym_id, member_id, code, expires_at)
           values ($1, $2, '654321', now() + interval '10 minutes')`,
          [IDS.gymB, IDS.memberA],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('own-gym staff can see and redeem the code; other-gym staff cannot', async () => {
    await seedCode();
    // Owner A sees it and can stamp used_at (the redeem write).
    const redeemed = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rowCount } = await c.query(
        `update public.checkin_codes set used_at = now() where id = $1 and used_at is null`,
        [CODE_ID],
      );
      return rowCount;
    });
    expect(redeemed).toBe(1);

    // Owner B (other tenant) neither sees nor touches it.
    const crossTenant = await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      const { rows } = await c.query(`select id from public.checkin_codes where id = $1`, [CODE_ID]);
      const { rowCount } = await c.query(
        `update public.checkin_codes set used_at = now() where id = $1`,
        [CODE_ID],
      );
      return { seen: rows.length, updated: rowCount };
    });
    expect(crossTenant).toEqual({ seen: 0, updated: 0 });
  });

  it('anon cannot read codes at all (no table grant)', async () => {
    await seedCode();
    await withSession({ role: 'anon' }, async (c) => {
      await expect(
        c.query(`select count(*) from public.checkin_codes`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it('two live codes with the same value cannot coexist in a gym', async () => {
    await seedCode();
    await withSession({ role: 'service_role' }, async (c) => {
      await expect(
        c.query(
          `insert into public.checkin_codes (gym_id, member_id, code, expires_at)
           values ($1, $2, '123456', now() + interval '10 minutes')`,
          [IDS.gymA, IDS.memberA],
        ),
      ).rejects.toThrow(/duplicate key/i);
    });
  });
});

describe('self check-out (checkins_update_self)', () => {
  it('member can close their own open visit', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await c.query(
        `insert into public.check_ins (id, gym_id, member_id, status, check_in_method)
         values ($1, $2, $3, 'active', 'self')`,
        [VISIT_ID, IDS.gymA, IDS.memberA],
      );
      const { rowCount } = await c.query(
        `update public.check_ins set checked_out_at = now(), status = 'completed'
         where id = $1 and checked_out_at is null`,
        [VISIT_ID],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('member cannot close someone else’s visit', async () => {
    await asSuperuser(async (c) => {
      await c.query(`delete from public.check_ins where id = $1`, [VISIT_ID]);
      await c.query(
        `insert into public.check_ins (id, gym_id, member_id, status, check_in_method)
         values ($1, $2, $3, 'active', 'self')`,
        [VISIT_ID, IDS.gymA, IDS.memberA],
      );
    });
    try {
      const updated = await withSession({ role: 'authenticated', uid: IDS.memberB }, async (c) => {
        const { rowCount } = await c.query(
          `update public.check_ins set checked_out_at = now(), status = 'completed' where id = $1`,
          [VISIT_ID],
        );
        return rowCount;
      });
      // The USING clause filters the row out — the update silently misses.
      expect(updated).toBe(0);
    } finally {
      await asSuperuser(async (c) => { await c.query(`delete from public.check_ins where id = $1`, [VISIT_ID]); });
    }
  });
});
