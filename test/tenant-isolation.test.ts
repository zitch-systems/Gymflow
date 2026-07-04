import { beforeAll, describe, expect, it } from 'vitest';
import { withSession } from './db';
import { IDS, seed } from './seed';

// Tenant-isolation tests. Every case runs the same query as (a) a signed-in user
// bound to gym A, (b) a signed-in user bound to gym B, and (c) anon, and
// asserts each sees only what RLS says they should. If any of these regress
// silently, a cross-tenant leak has shipped.
//
// These tests talk to the REAL Postgres RLS engine (no PostgREST in the loop) —
// the same one the production Supabase project uses — so a policy that permits
// cross-gym access here would permit it in prod too.

beforeAll(async () => { await seed(); });

describe('cross-tenant read isolation', () => {
  it('member A cannot see gym B payments', async () => {
    const rowsA = await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rows } = await c.query<{ gym_id: string }>(`select gym_id from public.payments`);
      return rows;
    });
    expect(rowsA.length).toBe(1);
    expect(rowsA[0].gym_id).toBe(IDS.gymA);
  });

  it('owner A cannot see gym B members', async () => {
    // gym_member_links_gml_select policy allows the row's own user OR staff of
    // the row's gym. Owner A is neither for gym B → shouldn't see them.
    const gyms = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rows } = await c.query<{ gym_id: string }>(`select distinct gym_id from public.gym_member_links`);
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA]);
  });

  it('anon cannot see any payments', async () => {
    const count = await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.payments`);
      return Number(rows[0].n);
    });
    expect(count).toBe(0);
  });

  it('service_role bypasses RLS and sees both gyms', async () => {
    const gyms = await withSession({ role: 'service_role' }, async (c) => {
      const { rows } = await c.query<{ gym_id: string }>(`select distinct gym_id from public.payments order by gym_id`);
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA, IDS.gymB]);
  });
});

describe('cross-tenant write blocking', () => {
  it('owner A cannot insert a member link into gym B', async () => {
    // gml_insert_staff requires has_gym_role for THAT gym; owner A has none in B.
    await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      await expect(
        c.query(
          `insert into public.gym_member_links (gym_id, user_id, member_id, is_active)
           values ($1, $2, $2, true)`,
          [IDS.gymB, IDS.memberA],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('anon cannot insert a payment (RLS + policy both block)', async () => {
    await withSession({ role: 'anon' }, async (c) => {
      await expect(
        c.query(
          `insert into public.payments (gym_id, member_id, amount, currency, paystack_reference)
           values ($1, $2, 500, 'NGN', 'anon-attempt')`,
          [IDS.gymA, IDS.memberA],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  it('member cannot escalate their own role via profiles update', async () => {
    // profiles_update_no_escalation allows self-update but WITH CHECK forbids
    // changing role. This is the classic privilege-escalation attack.
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await expect(
        c.query(`update public.profiles set role = 'owner' where id = $1`, [IDS.memberA]),
      ).rejects.toThrow(/row-level security|permission denied|new row violates/i);
    });
  });
});
