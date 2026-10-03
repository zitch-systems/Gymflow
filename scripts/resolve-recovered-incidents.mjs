// Resolve only a single-reference missing-local incident whose charge was
// subsequently recovered through the durable reconciliation queue. Dry-run is
// the default. Output contains counts only.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const ELIGIBLE_SQL = `
select i.id, p.id as payment_id, p.gym_id, j.completed_at
from public.operational_incidents i
join lateral (select completed_at from public.payment_webhook_jobs candidate
  where candidate.reference=i.reference and candidate.source='reconciliation'
    and candidate.event_name='charge.success' and candidate.status='completed'
    and candidate.verification_method='paystack_api' and candidate.verified_at is not null
    and candidate.completed_at>i.last_seen_at and candidate.last_error is null
  order by candidate.completed_at desc limit 1) j on true
join public.payments p on p.paystack_reference=i.reference
  and p.payment_status='successful' and p.status='success' and p.currency='NGN'
join public.payment_coverage_allocations a on a.payment_id=p.id
  and a.gym_id=p.gym_id and a.member_id=p.member_id
  and a.amount_kobo=round(p.amount*100)::bigint
join public.member_subscriptions s on s.id=a.subscription_id
  and s.gym_id=p.gym_id and s.member_id=p.member_id and s.plan_id=p.plan_id
where i.resolved_at is null
  and i.kind='reconciliation: Paystack charges missing locally'
  and i.context->'count'='1'::jsonb
  and nullif(i.reference,'') is not null
  and exists(select 1 from public.audit_logs al where al.action='member_charge_committed'
    and al.table_name='payments' and al.record_id=p.id and al.gym_id=p.gym_id)
  and not exists(select 1 from public.payment_refund_events r where r.reference=i.reference)
  and exists(select 1 from public.paystack_reconciliation_refs seen where seen.reference=i.reference)
  and not exists(select 1 from public.payment_webhook_jobs active where active.reference=i.reference
    and (active.status<>'completed' or active.last_error is not null))`;

export async function resolveRecoveredIncidents(client, { apply = false } = {}) {
  await client.query(apply ? 'begin isolation level serializable' : 'begin read only');
  try {
    await client.query("set local statement_timeout='15s'");
    await client.query("set local lock_timeout='2s'");
    const eligible = await client.query(`${ELIGIBLE_SQL}${apply ? ' for update of i,p,a,s' : ''}`);
    if (!apply) {
      await client.query('rollback');
      return { eligible: eligible.rowCount ?? eligible.rows.length, resolved: 0 };
    }
    let resolved = 0;
    for (const row of eligible.rows) {
      const changed = await client.query(`update public.operational_incidents
        set resolved_at=now(), context=context||jsonb_build_object(
          'resolution','verified_reconciliation_recovery','financial_rows_changed',false)
        where id=$1 and resolved_at is null returning id`, [row.id]);
      if ((changed.rowCount ?? 0) !== 1) continue;
      await client.query(`insert into public.audit_logs(action,gym_id,record_id,table_name,new_values)
        values('operational_incident_resolved',$1,$2,'operational_incidents',
          jsonb_build_object('resolution','verified_reconciliation_recovery',
            'recovery_completed_at',$3::timestamptz,'financial_rows_changed',false))`,
      [row.gym_id, row.id, row.completed_at]);
      resolved++;
    }
    await client.query('commit');
    return { eligible: eligible.rowCount ?? eligible.rows.length, resolved };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

export async function run(connectionString = process.env.SUPABASE_DB_URL, { apply = false } = {}) {
  if (!connectionString) throw new Error('SUPABASE_DB_URL is required');
  const client = new pg.Client({ connectionString, application_name: 'gymflow-resolve-recovered-incidents' });
  await client.connect();
  try { return await resolveRecoveredIncidents(client, { apply }); } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const unknown = process.argv.slice(2).filter((arg) => arg!=='--apply');
  if (unknown.length) {
    process.stderr.write('Usage: node scripts/resolve-recovered-incidents.mjs [--apply]\n');
    process.exitCode=2;
  } else {
    run(undefined,{apply:process.argv.includes('--apply')}).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch(() => { process.stderr.write('Incident resolution failed\n'); process.exitCode=1; });
  }
}
