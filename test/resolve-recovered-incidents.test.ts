import { beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { asSuperuser } from './db';
import { IDS, seed } from './seed';
import { resolveRecoveredIncidents } from '../scripts/resolve-recovered-incidents.mjs';

beforeEach(async () => {
  await seed();
  await asSuperuser(async (c) => {
    await c.query(`delete from public.payment_webhook_jobs where reference like 'resolver-%'`);
    await c.query(`delete from public.paystack_reconciliation_refs where reference like 'resolver-%'`);
    await c.query(`delete from public.operational_incidents where dedupe_key like 'resolver-%'`);
  });
});

async function fixture(c: PoolClient, suffix: string, change = '') {
  const ref = `resolver-${suffix}`;
  const payment = (await c.query(`insert into public.payments
    (gym_id,member_id,plan_id,amount,currency,paystack_reference,payment_method,status,payment_status,metadata)
    values($1,$2,$3,100,'NGN',$4,'card','success','successful','{"fulfillment_version":1}') returning id`,
  [IDS.gymA, IDS.memberA, IDS.planA, ref])).rows[0];
  const sub = (await c.query(`select id from public.member_subscriptions where gym_id=$1 and member_id=$2 limit 1`, [IDS.gymA, IDS.memberA])).rows[0];
  if (change !== 'noalloc') await c.query(`insert into public.payment_coverage_allocations
    (payment_id,gym_id,member_id,subscription_id,coverage_start,coverage_end,amount_kobo,original_start,original_end)
    values($1,$2,$3,$4,current_date,current_date+1,$5,current_date,current_date+1)`,
  [payment.id, IDS.gymA, IDS.memberA, sub.id, change === 'amount' ? 9999 : 10000]);
  if (change !== 'noaudit') await c.query(`insert into public.audit_logs(action,gym_id,record_id,table_name)
    values('member_charge_committed',$1,$2,'payments')`, [IDS.gymA, payment.id]);
  const incident = (await c.query(`insert into public.operational_incidents
    (dedupe_key,kind,reference,error,context,last_seen_at) values($1,$2,$3,'provider',$4,now()-interval '1 hour') returning id`,
  [`resolver-${suffix}`, change === 'unknownkind' ? 'reconciliation: local references unknown at Paystack' : 'reconciliation: Paystack charges missing locally', ref,
    JSON.stringify({ count: change === 'count' ? 2 : change === 'malformed' ? 'one' : 1 })])).rows[0];
  if (change !== 'unseen') await c.query(`insert into public.payment_webhook_jobs
    (body_hash,source,event_name,reference,payload_ciphertext,verified_at,verification_method,status,attempts,completed_at,last_error)
    values($1,'reconciliation','charge.success',$2,'cipher',now(),'paystack_api','completed',1,
      case when $3 then now()-interval '2 hours' else now() end,case when $4 then 'failed' else null end)`,
  [suffix.padEnd(64,'0').slice(0,64), ref, change === 'oldjob', change === 'errorjob']);
  if (change === 'wrongverify') await c.query(`update public.payment_webhook_jobs set verification_method='paystack_hmac' where reference=$1`,[ref]);
  if (change === 'active') await c.query(`insert into public.payment_webhook_jobs
    (body_hash,source,event_name,reference,payload_ciphertext,verified_at,verification_method,status)
    values($1,'reconciliation','charge.success',$2,'cipher',now(),'paystack_api','retry')`,[`active-${suffix}`,ref]);
  if (change === 'refund') await c.query(`insert into public.payment_refund_events
    (event_key,reference,event_name,amount_kobo,currency) values($1,$2,'refund.processed',10000,'NGN')`,[`refund-${suffix}`,ref]);
  await c.query(`insert into public.paystack_reconciliation_refs(reference,paid_at) values($1,now())`,[ref]);
  return incident.id;
}

describe('recovered reconciliation incident resolver', () => {
  it('resolves only fully evidenced single-reference recovery and is idempotent', async () => {
    await asSuperuser(async (c) => {
      const eligible = await fixture(c, 'eligible');
      for (const kind of ['count','malformed','oldjob','unknownkind','unseen','noalloc','amount','errorjob','noaudit','refund','active','wrongverify']) await fixture(c, kind, kind);
      expect(await resolveRecoveredIncidents(c)).toEqual({ eligible: 1, resolved: 0 });
      expect(await resolveRecoveredIncidents(c,{apply:true})).toEqual({ eligible: 1, resolved: 1 });
      expect(await resolveRecoveredIncidents(c,{apply:true})).toEqual({ eligible: 0, resolved: 0 });
      const rows = await c.query(`select dedupe_key,resolved_at is not null resolved from public.operational_incidents where dedupe_key like 'resolver-%' order by dedupe_key`);
      expect(rows.rows.filter((r) => r.resolved)).toEqual([{ dedupe_key: 'resolver-eligible', resolved: true }]);
      expect((await c.query(`select count(*)::int n from public.audit_logs where action='operational_incident_resolved' and record_id=$1`,[eligible])).rows[0].n).toBe(1);
    });
  });

  it('rolls back incident resolution when its audit insert fails', async () => {
    await asSuperuser(async (c) => {
      const id = await fixture(c, 'rollback');
      await c.query(`create function pg_temp.reject_resolution() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$`);
      await c.query(`create trigger reject_resolution before insert on public.audit_logs for each row when(new.action='operational_incident_resolved') execute function pg_temp.reject_resolution()`);
      await expect(resolveRecoveredIncidents(c,{apply:true})).rejects.toThrow(/forced audit failure/);
      expect((await c.query(`select resolved_at from public.operational_incidents where id=$1`,[id])).rows[0].resolved_at).toBeNull();
    });
  });
});
