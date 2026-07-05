import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Membership-freeze RLS + state-machine tests. Covers:
//   - member can NOT self-update status via the regular authenticated role
//     (memberships has no self-update policy; member_subscriptions'
//     msub_update_staff is staff-only)
//   - the check constraint permits the new 'pause_requested' value
//   - the sync trigger propagates freeze fields to memberships (and back)
//
// We drive the state directly at the row level (asSuperuser) rather than
// through the server actions — this is a DB-behavior contract test.

async function insertActiveSub(gymId: string, memberId: string): Promise<string> {
  return asSuperuser(async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(); end.setUTCDate(end.getUTCDate() + 30);
    const endIso = end.toISOString().slice(0, 10);
    const { rows } = await c.query<{ id: string }>(
      `insert into public.member_subscriptions (gym_id, member_id, start_date, end_date, status)
       values ($1, $2, $3, $4, 'active') returning id`,
      [gymId, memberId, today, endIso],
    );
    return rows[0].id;
  });
}

async function statusOf(subId: string): Promise<{ status: string; paused_at: string | null; pause_reason: string | null; end_date: string }> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(
      `select status, paused_at, pause_reason, end_date from public.member_subscriptions where id = $1`,
      [subId],
    );
    return rows[0];
  });
}

describe('membership freeze', () => {
  let subId: string;

  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    // Fresh sub row per test so state transitions don't bleed across cases.
    // Delete any subs the last test left behind.
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
    subId = await insertActiveSub(IDS.gymA, IDS.memberA);
  });

  it("pause_requested is now a valid status (constraint update)", async () => {
    await asSuperuser(async (c) => {
      // Would fail if the check constraint hadn't been widened.
      await c.query(
        `update public.member_subscriptions set status = 'pause_requested' where id = $1`,
        [subId],
      );
    });
    expect((await statusOf(subId)).status).toBe('pause_requested');
  });

  it('member cannot update their own subscription status directly (RLS blocks)', async () => {
    // memberA is authenticated; msub_update_staff requires a staff role. There
    // is no self-update policy on member_subscriptions, so this UPDATE affects
    // zero rows (silent no-op, not an error, per RLS semantics).
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rowCount } = await c.query(
        `update public.member_subscriptions set status = 'paused' where id = $1`,
        [subId],
      );
      expect(rowCount).toBe(0);
    });
    // Still 'active' — the write really was blocked.
    expect((await statusOf(subId)).status).toBe('active');
  });

  it('staff CAN update to paused + set paused_at (approve path)', async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const nowIso = new Date().toISOString();
      const { rowCount } = await c.query(
        `update public.member_subscriptions set status = 'paused', paused_at = $2 where id = $1`,
        [subId, nowIso],
      );
      expect(rowCount).toBe(1);
    });
    const state = await statusOf(subId);
    expect(state.status).toBe('paused');
    expect(state.paused_at).not.toBeNull();
  });

  it("other gym's staff can NOT update this gym's subscription (RLS gym-scopes writes)", async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      const { rowCount } = await c.query(
        `update public.member_subscriptions set status = 'paused' where id = $1`,
        [subId],
      );
      expect(rowCount).toBe(0);
    });
    expect((await statusOf(subId)).status).toBe('active');
  });

  it('resume compensates: end_date extended by days elapsed since paused_at', async () => {
    // Fake the "pause happened 3 days ago" state directly.
    await asSuperuser((c) => c.query(
      `update public.member_subscriptions
       set status = 'paused', paused_at = now() - interval '3 days'
       where id = $1`,
      [subId],
    ));
    const before = await statusOf(subId);

    // Staff resumes → drive the resumeFreeze() computation via SQL. This
    // mirrors the action: end_date += ceil((now - paused_at) / 1 day),
    // paused_at cleared, status back to active.
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      await c.query(
        `update public.member_subscriptions
         set status = 'active',
             paused_at = null,
             pause_reason = null,
             end_date = end_date + (ceil(extract(epoch from now() - paused_at) / 86400))::int
         where id = $1`,
        [subId],
      );
    });

    const after = await statusOf(subId);
    expect(after.status).toBe('active');
    expect(after.paused_at).toBeNull();
    // At least 3 days added; allow one extra for rounding across a day boundary.
    const beforeDate = new Date(before.end_date);
    const afterDate = new Date(after.end_date);
    const daysAdded = Math.round((afterDate.getTime() - beforeDate.getTime()) / 86400000);
    expect(daysAdded).toBeGreaterThanOrEqual(3);
    expect(daysAdded).toBeLessThanOrEqual(4);
  });

  it('sync trigger propagates freeze fields to the memberships mirror', async () => {
    await asSuperuser((c) => c.query(
      `update public.member_subscriptions
       set status = 'paused', paused_at = now(), pause_reason = 'Travel'
       where id = $1`,
      [subId],
    ));
    // The AFTER-UPDATE sync_subs_to_memberships trigger should have mirrored
    // the state onto memberships (matched by id).
    const mirror = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select status, paused_at, pause_reason from public.memberships where id = $1`,
        [subId],
      );
      return rows[0];
    });
    expect(mirror.status).toBe('paused');
    expect(mirror.paused_at).not.toBeNull();
    expect(mirror.pause_reason).toBe('Travel');
  });
});
