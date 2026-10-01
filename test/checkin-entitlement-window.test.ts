import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

beforeEach(async () => { await seed(); });
const actors = [
  { label: 'member', role: 'authenticated' as const, uid: IDS.memberA },
  { label: 'front desk/owner', role: 'authenticated' as const, uid: IDS.ownerA },
  { label: 'WhatsApp/service', role: 'service_role' as const },
];
const entry = (actor: typeof actors[number]) => withSession(actor, (c) => c.query(
  `insert into public.check_ins (gym_id,member_id,status,check_in_method)
   values ($1,$2,'active','self')`, [IDS.gymA, IDS.memberA],
));
const invalid = [
  ['expired date', "update public.member_subscriptions set end_date=(now() at time zone 'Africa/Lagos')::date-1 where member_id=$1"],
  ['future start', "update public.member_subscriptions set start_date=(now() at time zone 'Africa/Lagos')::date+1 where member_id=$1"],
  ['paused', "update public.member_subscriptions set status='paused' where member_id=$1"],
  ['pause requested', "update public.member_subscriptions set status='pause_requested' where member_id=$1"],
  ['cancelled', "update public.member_subscriptions set status='cancelled' where member_id=$1"],
  ['expired status', "update public.member_subscriptions set status='expired' where member_id=$1"],
  ['suspended member', 'update public.gym_member_links set is_active=false where user_id=$1'],
  ['offline gym', "update public.gyms set status='suspended' where id=$1"],
] as const;

describe('paid check-in window enforced at the DB boundary', () => {
  for (const [label, sql] of invalid) {
    it.each(actors)(`denies ${label} for $label`, async (actor) => {
      await asSuperuser((c) => c.query(sql, [label === 'offline gym' ? IDS.gymA : IDS.memberA]));
      await expect(entry(actor)).rejects.toThrow(/paid membership|invalid member|row-level security/i);
    });
  }

  for (const status of ['active', 'past_due']) {
    it.each(actors)(`allows a paid ${status} member through the final WAT day for $label`, async (actor) => {
      await asSuperuser((c) => c.query(`update public.member_subscriptions
        set status=$2,end_date=(now() at time zone 'Africa/Lagos')::date where member_id=$1`, [IDS.memberA, status]));
      expect((await entry(actor)).rowCount).toBe(1);
    });
  }

  it('rejects a future-start code before the member arrives', async () => {
    await asSuperuser((c) => c.query("update public.member_subscriptions set start_date=(now() at time zone 'Africa/Lagos')::date+1 where member_id=$1", [IDS.memberA]));
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) => c.query(
      "insert into public.checkin_codes (gym_id,member_id,code,expires_at) values ($1,$2,'384920',now()+interval '10 minutes')", [IDS.gymA, IDS.memberA],
    ))).rejects.toThrow(/paid membership/i);
  });

  it('two concurrent entry inserts leave exactly one open visit', async () => {
    const results = await Promise.allSettled(actors.slice(0, 2).map((actor) => withSession({ ...actor, commit: true }, (c) => c.query(
      "insert into public.check_ins (gym_id,member_id,status,check_in_method) values ($1,$2,'active','self')", [IDS.gymA, IDS.memberA],
    ))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const count = await asSuperuser(async (c) => (await c.query("select count(*)::int as n from public.check_ins where member_id=$1 and checked_out_at is null", [IDS.memberA])).rows[0].n);
    expect(count).toBe(1);
  });

  it('an overnight visit can be closed after entitlement expires', async () => {
    const id = await asSuperuser(async (c) => {
      const inserted = await c.query("insert into public.check_ins (gym_id,member_id,status,check_in_method,checked_in_at) values ($1,$2,'active','self',now()-interval '1 day') returning id", [IDS.gymA, IDS.memberA]);
      await c.query("update public.member_subscriptions set end_date=(now() at time zone 'Africa/Lagos')::date-1 where member_id=$1", [IDS.memberA]);
      return inserted.rows[0].id;
    });
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      expect((await c.query("insert into public.checkin_codes (gym_id,member_id,code,expires_at) values ($1,$2,'384920',now()+interval '10 minutes')", [IDS.gymA, IDS.memberA])).rowCount).toBe(1);
      expect((await c.query("update public.check_ins set status='completed',checked_out_at=now() where id=$1", [id])).rowCount).toBe(1);
    });
  });
});
