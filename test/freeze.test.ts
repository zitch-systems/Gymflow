import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, fixtureSessionId, withSession } from './db';
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

async function addPaidCoverage(subId: string, reference: string, startOffset: number, endOffset: number) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ payment_id: string }>(
      `with paid as (
         insert into public.payments
           (gym_id,member_id,plan_id,amount,currency,status,payment_status,payment_method,paystack_reference,payment_date)
         values ($1,$2,$3,10000,'NGN','success','successful','card',$5,now()) returning id
       )
       insert into public.payment_coverage_allocations
         (payment_id,gym_id,member_id,subscription_id,coverage_start,coverage_end,amount_kobo)
       select id,$1,$2,$4,current_date+$6::int,current_date+$7::int,1000000 from paid
       returning payment_id`,
      [IDS.gymA, IDS.memberA, IDS.planA, subId, reference, startOffset, endOffset],
    );
    return rows[0].payment_id;
  });
}

async function pauseWithWindow(subId: string, endOffset = 30) {
  await asSuperuser((c) => c.query(
    `update public.member_subscriptions set
       status='paused', start_date=current_date-10, end_date=current_date+$2::int,
       paused_at=now()-interval '3 days', pause_start=current_date-3,
       pause_end=current_date+7
     where id=$1`,
    [subId, endOffset],
  ));
}

async function resume(subId: string, sessionSalt = 'resume') {
  return withSession({
    role: 'authenticated', uid: IDS.ownerA,
    sessionId: fixtureSessionId(IDS.ownerA, sessionSalt), commit: true,
  }, async (c) => {
    const { rows } = await c.query(
      `select public.resume_member_freeze($1,$2) as result`,
      [IDS.gymA, subId],
    );
    return rows[0].result as {
      created: boolean; member_id: string; end_date: string;
      days_credited: number; status: string;
    };
  });
}

describe('membership freeze', () => {
  let subId: string;

  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    // Fresh sub row per test so state transitions don't bleed across cases.
    // Delete any subs the last test left behind.
    await asSuperuser(async (c) => {
      await c.query(
        `delete from public.payment_refund_events where reference like 'freeze-%'`,
      );
      await c.query(
        `delete from public.payment_coverage_allocations where member_id=$1`,
        [IDS.memberA],
      );
      await c.query(
        `delete from public.payments where member_id=$1 and paystack_reference like 'freeze-%'`,
        [IDS.memberA],
      );
      await c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]);
    });
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

  it('atomically restores only elapsed, paid freeze days and preserves the purchased dates', async () => {
    await pauseWithWindow(subId);
    await addPaidCoverage(subId, 'freeze-basic', -10, 30);

    const result = await resume(subId);
    const state = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select s.status,s.paused_at,s.end_date-current_date days_to_end,
           a.coverage_end-current_date coverage_to_end,
           a.original_start-current_date original_start,
           a.original_end-current_date original_end,
           (select count(*)::int from public.audit_logs
             where record_id=s.id and action='membership_freeze_resumed') resume_audits
         from public.member_subscriptions s
         join public.payment_coverage_allocations a on a.subscription_id=s.id
         where s.id=$1`,
        [subId],
      );
      return rows[0];
    });

    expect(result).toMatchObject({ created: true, member_id: IDS.memberA, days_credited: 3, status: 'active' });
    expect(state).toMatchObject({
      status: 'active', paused_at: null, days_to_end: 33, coverage_to_end: 33,
      original_start: -10, original_end: 30, resume_audits: 1,
    });
  });

  it('restores a legacy paid term that predates coverage allocations', async () => {
    await pauseWithWindow(subId);

    const result = await resume(subId, 'resume-legacy');
    const state = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select status,end_date-current_date days_to_end,
           (select count(*)::int from public.payment_coverage_allocations
             where subscription_id=$1) allocation_count
         from public.member_subscriptions where id=$1`,
        [subId],
      );
      return rows[0];
    });

    expect(result).toMatchObject({ created: true, days_credited: 3, status: 'active' });
    expect(state).toMatchObject({ status: 'active', days_to_end: 33, allocation_count: 0 });
  });

  it('serializes two resume attempts and credits the paid term once', async () => {
    await pauseWithWindow(subId);
    await addPaidCoverage(subId, 'freeze-double', -10, 30);

    const results = await Promise.all([
      resume(subId, 'resume-a'),
      resume(subId, 'resume-b'),
    ]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results.reduce((sum, r) => sum + r.days_credited, 0)).toBe(3);

    const state = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select s.end_date-current_date days_to_end,a.coverage_end-current_date coverage_to_end,
           (select count(*)::int from public.audit_logs
             where record_id=s.id and action='membership_freeze_resumed') resume_audits
         from public.member_subscriptions s
         join public.payment_coverage_allocations a on a.subscription_id=s.id
         where s.id=$1`,
        [subId],
      );
      return rows[0];
    });
    expect(state).toMatchObject({ days_to_end: 33, coverage_to_end: 33, resume_audits: 1 });
  });

  it('serializes a concurrent payment and resume without losing or overlapping coverage', async () => {
    await pauseWithWindow(subId);
    await addPaidCoverage(subId, 'freeze-existing', -10, 30);
    await asSuperuser((c) => c.query(
      `insert into public.member_payment_checkouts
         (reference,gym_id,member_id,plan_id,amount_kobo,duration_days,duration_months)
       values ('freeze-concurrent-pay',$1,$2,$3,1000000,10,0)`,
      [IDS.gymA, IDS.memberA, IDS.planA],
    ));

    const [resumed, paid] = await Promise.all([
      resume(subId, 'resume-payment-race'),
      withSession({ role: 'service_role', commit: true }, async (c) => {
        const { rows } = await c.query(
          `select public.settle_member_charge(
             'freeze-concurrent-pay',$1,$2,$3,1000000,'NGN',10,0,false,'card','{}'::jsonb,$4
           ) as result`,
          [IDS.gymA, IDS.memberA, IDS.planA, subId],
        );
        return rows[0].result as { created: boolean };
      }),
    ]);
    expect(resumed).toMatchObject({ created: true, days_credited: 3 });
    expect(paid.created).toBe(true);

    const rows = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select a.coverage_start-current_date coverage_start,
           a.coverage_end-current_date coverage_end,
           a.original_start-current_date original_start,
           a.original_end-current_date original_end,
           s.end_date-current_date subscription_end
         from public.payment_coverage_allocations a
         join public.member_subscriptions s on s.id=a.subscription_id
         where a.subscription_id=$1 order by a.coverage_start`,
        [subId],
      );
      return rows;
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ coverage_start: -10, coverage_end: 33, original_start: -10, original_end: 30 });
    expect(rows[1]).toMatchObject({ coverage_start: 34, coverage_end: 43, subscription_end: 43 });
    expect(rows[1].original_end - rows[1].original_start).toBe(9);
  });

  it('does not resurrect access when the paid allocation was fully refunded while paused', async () => {
    await pauseWithWindow(subId, 9);
    await addPaidCoverage(subId, 'freeze-refunded', -10, 9);
    await withSession({ role: 'service_role', commit: true }, (c) => c.query(
      `select public.apply_payment_refund(
         'freeze-refund-event','freeze-refunded','refund.processed',1000000,'NGN',false
       )`,
    ));

    const result = await resume(subId, 'resume-refunded');
    const state = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select s.status,s.end_date-current_date days_to_end,
           a.revoked_at is not null revoked,a.coverage_end-current_date coverage_to_end
         from public.member_subscriptions s
         join public.payment_coverage_allocations a on a.subscription_id=s.id
         where s.id=$1`,
        [subId],
      );
      return rows[0];
    });
    expect(result).toMatchObject({ created: true, days_credited: 0, status: 'expired' });
    expect(state).toMatchObject({ status: 'expired', days_to_end: -4, revoked: true, coverage_to_end: 9 });
  });

  it('requires an exact verified privileged staff session', async () => {
    await pauseWithWindow(subId);
    await addPaidCoverage(subId, 'freeze-unverified', -10, 30);
    await expect(withSession(
      { role: 'authenticated', uid: IDS.ownerA, verified: false },
      (c) => c.query(`select public.resume_member_freeze($1,$2)`, [IDS.gymA, subId]),
    )).rejects.toMatchObject({ code: '42501' });
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

  it('sync trigger propagates the pause_start/pause_end window to the mirror', async () => {
    await asSuperuser((c) => c.query(
      `update public.member_subscriptions
       set status = 'paused', paused_at = now(),
           pause_start = current_date, pause_end = current_date + 14
       where id = $1`,
      [subId],
    ));
    const mirror = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select pause_start, pause_end from public.memberships where id = $1`,
        [subId],
      );
      return rows[0];
    });
    expect(mirror.pause_start).not.toBeNull();
    expect(mirror.pause_end).not.toBeNull();
    // Window spans 14 days.
    const days = Math.round((new Date(mirror.pause_end).getTime() - new Date(mirror.pause_start).getTime()) / 86400000);
    expect(days).toBe(14);
  });

  it('gyms.member_freeze_enabled defaults to true and is toggleable', async () => {
    const enabled = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select member_freeze_enabled from public.gyms where id = $1`,
        [IDS.gymA],
      );
      return rows[0].member_freeze_enabled;
    });
    expect(enabled).toBe(true);

    await asSuperuser((c) => c.query(
      `update public.gyms set member_freeze_enabled = false where id = $1`, [IDS.gymA],
    ));
    const after = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select member_freeze_enabled from public.gyms where id = $1`, [IDS.gymA],
      );
      return rows[0].member_freeze_enabled;
    });
    expect(after).toBe(false);
    // Restore so later suites see the default.
    await asSuperuser((c) => c.query(
      `update public.gyms set member_freeze_enabled = true where id = $1`, [IDS.gymA],
    ));
  });
});
