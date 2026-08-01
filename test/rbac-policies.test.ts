import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from './db';
import type { PoolClient } from 'pg';
import { IDS, seed } from './seed';

// Regression tests for the DB-layer authorization fixes in
// 20260716_prelaunch_hardening.sql, 20260716_rbac_access_view_fixes.sql and
// 20260717_can_see_profile_inactive_staff.sql.
//
// Why these exist: those three migrations sat in the repo unapplied on the live
// project for two weeks, and nothing caught it — the CI drift gate compares
// object *names*, and a `drop policy` + `create policy` with the same name and
// command is invisible to it. These tests assert the *behaviour* each fix
// creates, so a live database (or a future migration) that loses it fails here.
//
// Each case runs the real Postgres RLS engine against a DB built from the
// checked-in migrations. Setup rows are written as superuser inside the same
// transaction as the attack, then rolled back, so nothing leaks between tests.

beforeAll(async () => { await seed(); });

const OUTSIDER = 'd1111111-1111-1111-1111-111111111111';

// One transaction, rolled back. Setup runs as the pool's superuser; call
// becomeUser() to continue as a signed-in user with RLS in force.
async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* tx may already be aborted */ }
    throw e;
  } finally {
    client.release();
  }
}

async function becomeUser(c: PoolClient, uid: string, role: 'authenticated' | 'anon' = 'authenticated') {
  await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
  await c.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
  await c.query(`SET LOCAL ROLE ${role}`);
}

// A signed-in user who holds no links anywhere, for tests that need a staff
// link with a specific role without disturbing the seeded cast.
async function makeOutsider(c: PoolClient) {
  await c.query(`insert into auth.users (id, email) values ($1, $2)`, [OUTSIDER, 'outsider@example.com']);
}

describe('gym_staff_links write policy (prelaunch_hardening §1)', () => {
  // The bug: `for ALL` with `user_id = auth.uid()` in USING and no explicit
  // WITH CHECK. Postgres reuses USING as the write-check, so the self branch
  // accepted any gym_id/role the attacker chose — a one-INSERT tenant takeover.
  it('a member cannot grant themselves a staff link on another gym', async () => {
    await inTx(async (c) => {
      await becomeUser(c, IDS.memberA);
      await expect(
        c.query(
          `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
           values ($1, $2, 'gym_owner', true)`,
          [IDS.gymB, IDS.memberA],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('a member cannot grant themselves a staff link on their own gym', async () => {
    await inTx(async (c) => {
      await becomeUser(c, IDS.memberA);
      await expect(
        c.query(
          `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
           values ($1, $2, 'gym_owner', true)`,
          [IDS.gymA, IDS.memberA],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('a front_desk staffer cannot promote their own link to gym_owner', async () => {
    const after = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', true)`,
        [IDS.gymA, OUTSIDER],
      );
      await becomeUser(c, OUTSIDER);
      // front_desk fails the USING check, so the row is invisible to the
      // UPDATE — no error, zero rows touched.
      const res = await c.query(
        `update public.gym_staff_links set role = 'gym_owner' where user_id = $1`,
        [OUTSIDER],
      );
      expect(res.rowCount).toBe(0);
      const { rows } = await c.query<{ role: string }>(
        `select role from public.gym_staff_links where user_id = $1`,
        [OUTSIDER],
      );
      return rows;
    });
    expect(after).toEqual([{ role: 'front_desk' }]);
  });

  it('an owner can still write staff links for their own gym', async () => {
    // The fix must not break the legitimate path the policy exists to serve.
    const rowCount = await inTx(async (c) => {
      await makeOutsider(c);
      await becomeUser(c, IDS.ownerA);
      const res = await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', true)`,
        [IDS.gymA, OUTSIDER],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
  });

  it('a staffer can still read their own link back', async () => {
    // gym_staff_links_select_own is what keeps the DAL working after the ALL
    // policy stopped admitting the self branch.
    const gyms = await inTx(async (c) => {
      await becomeUser(c, IDS.ownerA);
      const { rows } = await c.query<{ gym_id: string }>(
        `select gym_id from public.gym_staff_links where user_id = $1`,
        [IDS.ownerA],
      );
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA]);
  });
});

describe('payments read policy (rbac_access_view_fixes §1)', () => {
  it('an instructor cannot read the gym’s payments', async () => {
    const count = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'instructor', true)`,
        [IDS.gymA, OUTSIDER],
      );
      await becomeUser(c, OUTSIDER);
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.payments`);
      return Number(rows[0].n);
    });
    expect(count).toBe(0);
  });

  it('front_desk in the same gym still can', async () => {
    // Same fixture, one role different — proves the test above is measuring
    // the role filter and not some unrelated denial.
    const gyms = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', true)`,
        [IDS.gymA, OUTSIDER],
      );
      await becomeUser(c, OUTSIDER);
      const { rows } = await c.query<{ gym_id: string }>(`select gym_id from public.payments`);
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA]);
  });
});

describe('is_platform_admin() honours is_active (rbac_access_view_fixes §2)', () => {
  it('a deactivated platform admin is not a platform admin', async () => {
    const result = await inTx(async (c) => {
      await c.query(
        `insert into public.platform_admins (user_id, name, email, is_active)
         values ($1, 'Deactivated', 'deactivated@gymflow.ng', false)`,
        [IDS.memberA],
      );
      await becomeUser(c, IDS.memberA);
      const { rows } = await c.query<{ ok: boolean }>(`select private.is_platform_admin() as ok`);
      const { rows: pay } = await c.query<{ gym_id: string }>(`select distinct gym_id from public.payments`);
      return { isAdmin: rows[0].ok, gyms: pay.map((r) => r.gym_id) };
    });
    expect(result.isAdmin).toBe(false);
    // Only their own payment — no cross-tenant reach.
    expect(result.gyms).toEqual([IDS.gymA]);
  });

  it('an active platform admin still sees every gym', async () => {
    const result = await inTx(async (c) => {
      await c.query(
        `insert into public.platform_admins (user_id, name, email, is_active)
         values ($1, 'Active', 'active@gymflow.ng', true)`,
        [IDS.memberA],
      );
      await becomeUser(c, IDS.memberA);
      const { rows } = await c.query<{ ok: boolean }>(`select private.is_platform_admin() as ok`);
      const { rows: pay } = await c.query<{ gym_id: string }>(
        `select distinct gym_id from public.payments order by gym_id`,
      );
      return { isAdmin: rows[0].ok, gyms: pay.map((r) => r.gym_id) };
    });
    expect(result.isAdmin).toBe(true);
    expect(result.gyms).toEqual([IDS.gymA, IDS.gymB]);
  });
});

describe('notifications read policy (rbac_access_view_fixes §3)', () => {
  // The reminder cooldown reads notifications through the caller's session; a
  // front_desk actor used to get zero rows and re-send every reminder.
  it('front_desk can read the gym’s notifications', async () => {
    const count = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', true)`,
        [IDS.gymA, OUTSIDER],
      );
      await c.query(
        `insert into public.notifications (gym_id, user_id, title, body)
         values ($1, $2, 'Expiring soon', 'Your membership expires in 3 days')`,
        [IDS.gymA, IDS.memberA],
      );
      await becomeUser(c, OUTSIDER);
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.notifications`);
      return Number(rows[0].n);
    });
    expect(count).toBe(1);
  });

  it('staff of another gym still cannot', async () => {
    const count = await inTx(async (c) => {
      await c.query(
        `insert into public.notifications (gym_id, user_id, title, body)
         values ($1, $2, 'Expiring soon', 'Your membership expires in 3 days')`,
        [IDS.gymA, IDS.memberA],
      );
      await becomeUser(c, IDS.ownerB);
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.notifications`);
      return Number(rows[0].n);
    });
    expect(count).toBe(0);
  });
});

describe('gyms insert policy (rbac_access_view_fixes §4)', () => {
  it('an ordinary authenticated user cannot create a gym', async () => {
    await inTx(async (c) => {
      await becomeUser(c, IDS.memberA);
      await expect(
        c.query(`insert into public.gyms (slug, name) values ('squatter', 'Squatter Fitness')`),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('a gym owner cannot create a gym either', async () => {
    // Provisioning is service-role only; owning one gym grants nothing here.
    await inTx(async (c) => {
      await becomeUser(c, IDS.ownerA);
      await expect(
        c.query(`insert into public.gyms (slug, name) values ('second-site', 'Second Site')`),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });
});

describe('can_see_profile() and suspended staff (can_see_profile_inactive_staff)', () => {
  it('a suspended staffer stays visible to their own gym', async () => {
    // Before the fix the target's link had to be active, so suspending someone
    // 404'd their detail page and you could not reactivate them.
    const visible = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', false)`,
        [IDS.gymA, OUTSIDER],
      );
      await becomeUser(c, IDS.ownerA);
      const { rows } = await c.query<{ ok: boolean }>(`select public.can_see_profile($1) as ok`, [OUTSIDER]);
      return rows[0].ok;
    });
    expect(visible).toBe(true);
  });

  it('a suspended staffer at another gym stays invisible', async () => {
    // The viewer's same-gym requirement is unchanged — this is the half of the
    // predicate the fix must not widen.
    const visible = await inTx(async (c) => {
      await makeOutsider(c);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'front_desk', false)`,
        [IDS.gymB, OUTSIDER],
      );
      await becomeUser(c, IDS.ownerA);
      const { rows } = await c.query<{ ok: boolean }>(`select public.can_see_profile($1) as ok`, [OUTSIDER]);
      return rows[0].ok;
    });
    expect(visible).toBe(false);
  });
});
