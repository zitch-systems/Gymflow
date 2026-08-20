import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Deleting an auth user must not be able to erase money or legal records.
//
// profiles.id cascades from auth.users(id), and most of the schema cascades
// from profiles(id) — so one operator click in the Supabase dashboard used to
// take a member's whole payment history, their signed waivers and an
// instructor's payouts with it. 20260822090000 flips the money/legal FKs to ON
// DELETE RESTRICT so that path raises 23503 instead.
//
// These are DB-behaviour contract tests: they drive auth.users directly as
// superuser, which is exactly what the dashboard / auth.admin.deleteUser does.
// Every destructive probe runs in its own transaction that is rolled back, so
// the fixtures the rest of the suite shares survive.

const INSTRUCTOR = 'd1111111-1111-1111-1111-111111111111';
const LEAD = 'd2222222-2222-2222-2222-222222222222';
const WAIVER = 'd3333333-3333-3333-3333-333333333333';

// Run `fn` inside a transaction that is always rolled back, so a probe can
// insert fixtures, attempt the delete, and leave no trace either way.
async function inRolledBackTx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  return asSuperuser(async (c) => {
    await c.query('begin');
    try { return await fn(c); } finally { await c.query('rollback'); }
  });
}

// The shape a foreign-key violation arrives in from node-postgres.
function fkViolation(e: unknown): { code: string; constraint: string } {
  const err = e as { code?: string; constraint?: string };
  return { code: err.code ?? '', constraint: err.constraint ?? '' };
}

describe('financial and legal records survive an auth user delete', () => {
  beforeAll(async () => {
    await seed();
    await asSuperuser(async (c) => {
      // An instructor with a payout, and a lead with no history at all.
      for (const [id, email] of [[INSTRUCTOR, 'instructor@example.com'], [LEAD, 'lead@example.com']] as const) {
        await c.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
      }
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'instructor', true)`,
        [IDS.gymA, INSTRUCTOR],
      );
      await c.query(
        `insert into public.waivers (id, gym_id, title, content) values ($1, $2, 'Liability', 'body')`,
        [WAIVER, IDS.gymA],
      );
    });
  });

  it('refuses to delete a member who has payments, and keeps the ledger', async () => {
    const result = await inRolledBackTx(async (c) => {
      const before = await c.query(`select count(*)::int n from public.payments where member_id = $1`, [IDS.memberA]);
      let violation = { code: '', constraint: '' };
      try {
        await c.query(`delete from auth.users where id = $1`, [IDS.memberA]);
      } catch (e) { violation = fkViolation(e); }
      // The failed statement aborted the transaction, so read the survivors on
      // a fresh one after the rollback rather than here.
      return { before: before.rows[0].n, violation };
    });
    expect(result.before).toBeGreaterThan(0);
    expect(result.violation.code).toBe('23503');
    expect(result.violation.constraint).toBe('payments_member_id_fkey');

    const after = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select count(*)::int n from public.payments where member_id = $1`, [IDS.memberA]);
      return rows[0].n;
    });
    expect(after).toBe(result.before);
  });

  it('refuses to delete an instructor who has payouts', async () => {
    const violation = await inRolledBackTx(async (c) => {
      await c.query(
        `insert into public.instructor_payouts (gym_id, instructor_id, amount, status)
         values ($1, $2, 45000, 'paid')`,
        [IDS.gymA, INSTRUCTOR],
      );
      try {
        await c.query(`delete from auth.users where id = $1`, [INSTRUCTOR]);
        return { code: 'no-error', constraint: '' };
      } catch (e) { return fkViolation(e); }
    });
    expect(violation.code).toBe('23503');
    expect(violation.constraint).toBe('instructor_payouts_instructor_id_fkey');
  });

  it('refuses to delete a member who signed a waiver, even with no payments', async () => {
    const violation = await inRolledBackTx(async (c) => {
      await c.query(
        `insert into public.waiver_signatures (waiver_id, member_id, gym_id, signature)
         values ($1, $2, $3, 'squiggle')`,
        [WAIVER, LEAD, IDS.gymA],
      );
      try {
        await c.query(`delete from auth.users where id = $1`, [LEAD]);
        return { code: 'no-error', constraint: '' };
      } catch (e) { return fkViolation(e); }
    });
    expect(violation.code).toBe('23503');
    expect(violation.constraint).toBe('waiver_signatures_member_id_fkey');
  });

  it('refuses to delete a staffer who has been paid a salary', async () => {
    // salary_payments has no FK to profiles — it reaches auth.users through
    // gym_staff_links.user_id, so that link is the one that has to hold.
    const violation = await inRolledBackTx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select id from public.gym_staff_links where user_id = $1 and gym_id = $2`,
        [INSTRUCTOR, IDS.gymA],
      );
      await c.query(
        `insert into public.salary_payments (gym_id, staff_link_id, amount, payment_date)
         values ($1, $2, 120000, current_date)`,
        [IDS.gymA, rows[0].id],
      );
      try {
        await c.query(`delete from auth.users where id = $1`, [INSTRUCTOR]);
        return { code: 'no-error', constraint: '' };
      } catch (e) { return fkViolation(e); }
    });
    expect(violation.code).toBe('23503');
    expect(violation.constraint).toBe('salary_payments_staff_link_id_fkey');
  });

  it('still deletes a lead with no financial or legal history, cascade and all', async () => {
    // The guard is scoped to money and legal records on purpose: a person who
    // never paid, never signed and was never paid out is genuinely erasable,
    // and their personal rows should follow them out.
    const out = await inRolledBackTx(async (c) => {
      await c.query(
        `insert into public.gym_member_links (gym_id, user_id, member_id, is_active) values ($1, $2, $2, true)`,
        [IDS.gymA, LEAD],
      );
      await c.query(`delete from auth.users where id = $1`, [LEAD]);
      const { rows } = await c.query(
        `select (select count(*)::int from public.profiles where id = $1) profiles,
                (select count(*)::int from public.gym_member_links where user_id = $1) links`,
        [LEAD],
      );
      return rows[0];
    });
    expect(out).toEqual({ profiles: 0, links: 0 });
  });

  it('leaves the in-app member removal flow working', async () => {
    // setMemberActive (lib/actions/admin-member.ts) suspends by flipping
    // gym_member_links.is_active — it never deletes a profile. That path must
    // keep working through RLS, and must not touch the member's payments.
    const out = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const upd = await c.query(
        `update public.gym_member_links set is_active = false
          where gym_id = $1 and member_id = $2 returning is_active`,
        [IDS.gymA, IDS.memberA],
      );
      const pay = await c.query(`select count(*)::int n from public.payments where member_id = $1`, [IDS.memberA]);
      return { suspended: upd.rows[0]?.is_active, payments: pay.rows[0].n };
    });
    expect(out.suspended).toBe(false);
    expect(out.payments).toBeGreaterThan(0);
  });
});
