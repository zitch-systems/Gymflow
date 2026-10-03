// Read-only production operations inspection. Output is deliberately limited
// to catalog labels, timestamps, booleans and aggregate counts. It never emits
// payment references, tenant/member IDs, provider payloads or raw error text.

import { pathToFileURL } from 'node:url';
import pg from 'pg';

const SAFE_LABEL = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;
const INCIDENT_KINDS = new Map([
  ['reconciliation: Paystack charges missing locally', 'provider_charge_missing_locally'],
  ['reconciliation: local references unknown at Paystack', 'local_reference_unknown_at_provider'],
  ['reconciliation sweep failed', 'reconciliation_sweep_failed'],
  ['paystack recovery requires operator repair', 'webhook_operator_repair'],
  ['refund entitlement allocation requires review', 'refund_allocation_review'],
  ['platform billing: superseded Paystack subscription could not be disabled', 'superseded_subscription_active'],
  ['platform billing: settled charge was already fully refunded', 'settled_charge_refunded'],
  ['legacy member charge below current plan price', 'legacy_charge_price_mismatch'],
  ['member auto-renew initialization not confirmed', 'auto_renew_initialization_unconfirmed'],
  ['gym backup queue is overdue', 'gym_backup_queue_overdue'],
  ['gym backup failed', 'gym_backup_failed'],
  ['gym backup completed with problems', 'gym_backup_partial'],
]);

export function incidentKind(value) {
  return INCIDENT_KINDS.get(value) ?? 'unclassified_incident';
}

export function safeLabel(value, fallback = 'unclassified') {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SAFE_LABEL.test(normalized) ? normalized : fallback;
}

export function errorClass(value) {
  const message = String(value ?? '').toLowerCase();
  if (!message) return 'none';
  if (/decrypt|cipher|authentication tag|encryption key/.test(message)) return 'payload_decryption';
  if (/timeout|timed out|deadline|abort/.test(message)) return 'timeout';
  if (/rate.?limit|too many requests|\b429\b/.test(message)) return 'rate_limited';
  if (/unauthori[sz]ed|forbidden|permission|\b401\b|\b403\b|credential/.test(message)) return 'authentication';
  if (/network|fetch failed|econn|enotfound|socket|dns/.test(message)) return 'network';
  if (/paystack|provider|transaction.*(missing|not found|failed)|verification/.test(message)) return 'provider';
  if (/constraint|duplicate|conflict|foreign key|23505|23503|23514/.test(message)) return 'database_integrity';
  if (/database|postgres|supabase|query/.test(message)) return 'database';
  if (/invalid|malformed|mismatch|unsupported|missing|required/.test(message)) return 'invalid_data';
  return 'application';
}

function count(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('database returned an invalid aggregate count');
  return parsed;
}

export async function operationsSnapshot(client) {
  await client.query('begin read only');
  try {
    await client.query("set local statement_timeout = '15s'");
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local idle_in_transaction_session_timeout = '30s'");

    const jobs = await client.query(`select job_name, last_started_at, last_heartbeat_at,
        last_succeeded_at, watermark, consecutive_failures, last_error is not null as has_error,
        last_error
      from public.operational_job_state order by job_name`);
    const incidents = await client.query(`select i.kind, i.error, i.attempts, i.first_seen_at, i.last_seen_at,
        i.reference is not null as has_reference,
        case when i.context->>'count' ~ '^[0-9]{1,9}$' then (i.context->>'count')::integer else null end as affected_count,
        exists(select 1 from public.payments p where p.paystack_reference=i.reference) as member_payment_exists,
        exists(select 1 from public.platform_payments p where p.paystack_reference=i.reference) as platform_payment_exists,
        exists(select 1 from public.paystack_reconciliation_refs r where r.reference=i.reference) as provider_reference_observed,
        exists(select 1 from public.payment_webhook_jobs j where j.reference=i.reference and j.status='completed') as recovery_completed,
        exists(select 1 from public.payment_webhook_jobs j where j.reference=i.reference and j.status<>'completed') as recovery_pending
      from public.operational_incidents i where i.resolved_at is null order by i.kind, i.last_seen_at`);
    const queues = await client.query(`select
      (select count(*) from public.payment_webhook_jobs where status in ('queued','retry') and next_attempt_at <= now()) as webhook_due,
      (select count(*) from public.payment_webhook_jobs where status='processing') as webhook_processing,
      (select count(*) from public.payment_webhook_jobs where status='dead') as webhook_dead,
      (select min(received_at) from public.payment_webhook_jobs where status in ('queued','retry','processing','dead')) as webhook_oldest,
      (select count(*) from public.gym_backup_jobs where status in ('queued','retry') and next_attempt_at <= now()) as backup_due,
      (select count(*) from public.gym_backup_jobs where status='processing') as backup_processing,
      (select min(due_at) from public.gym_backup_jobs) as backup_oldest_due`);
    const memberPayments = await client.query(`with classified as (
      select date_trunc('month', p.payment_date)::date as payment_month,
        coalesce(nullif(p.payment_method,''),'unknown') as payment_method,
        (p.plan_id is not null) as has_plan_id, (mp.id is not null) as plan_exists,
        ((p.metadata->>'fulfillment_version') is distinct from '1') as legacy_path,
        exists(select 1 from public.member_payment_checkouts co where co.reference=p.paystack_reference) as has_checkout,
        exists(select 1 from public.staff_financial_operations fo where fo.payment_id=p.id) as has_staff_operation,
        exists(select 1 from public.audit_logs al where al.record_id=p.id
          and al.action in ('member_charge_committed','staff_payment_committed')) as has_commit_audit,
        exists(select 1 from public.payment_refund_events r where r.reference=p.paystack_reference) as has_refund_event,
        p.payment_date
      from public.payments p
      left join public.payment_coverage_allocations a on a.payment_id=p.id
      left join public.membership_plans mp on mp.id=p.plan_id
      where p.payment_status='successful' and a.payment_id is null
    ) select payment_month,payment_method,has_plan_id,plan_exists,legacy_path,has_checkout,
        has_staff_operation,has_commit_audit,has_refund_event,count(*) as payment_count,
        min(payment_date) as earliest_payment_at,max(payment_date) as latest_payment_at
      from classified group by 1,2,3,4,5,6,7,8,9 order by 1,2,3,4,5,6,7,8,9`);
    const platformPayments = await client.query(`with classified as (
      select date_trunc('month', p.created_at)::date as payment_month,
        coalesce(nullif(p.plan,''),'unknown') as plan,
        not exists(select 1 from public.audit_logs al where al.record_id=p.id
          and al.action='platform_charge_committed') as legacy_path,
        p.billing_period_start is not null and p.billing_period_end is not null as has_billing_period,
        (p.billing_period_end > p.billing_period_start) as valid_billing_period,
        exists(select 1 from public.payment_refund_events r where r.reference=p.paystack_reference) as has_refund_event,
        p.created_at
      from public.platform_payments p
      left join public.platform_payment_coverage a on a.payment_id=p.id
      where p.payment_status='successful' and a.payment_id is null
    ) select payment_month,plan,legacy_path,has_billing_period,valid_billing_period,has_refund_event,
        count(*) as payment_count,min(created_at) as earliest_payment_at,max(created_at) as latest_payment_at
      from classified group by 1,2,3,4,5,6 order by 1,2,3,4,5,6`);

    const incidentGroups = new Map();
    for (const row of incidents.rows) {
      const key = `${incidentKind(row.kind)}|${errorClass(row.error)}`;
      const existing = incidentGroups.get(key) ?? {
        kind: incidentKind(row.kind), error_class: errorClass(row.error), open_count: 0,
        total_attempts: 0, first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at,
        affected_count: 0, with_reference: 0, with_member_payment: 0, with_platform_payment: 0,
        with_provider_reference_observed: 0, with_recovery_completed: 0, with_recovery_pending: 0,
      };
      existing.open_count += 1;
      existing.total_attempts += count(row.attempts);
      existing.affected_count += count(row.affected_count ?? 0);
      for (const [field, source] of [
        ['with_reference', 'has_reference'], ['with_member_payment', 'member_payment_exists'],
        ['with_platform_payment', 'platform_payment_exists'], ['with_provider_reference_observed', 'provider_reference_observed'],
        ['with_recovery_completed', 'recovery_completed'], ['with_recovery_pending', 'recovery_pending'],
      ]) if (row[source] === true) existing[field] += 1;
      if (new Date(row.first_seen_at) < new Date(existing.first_seen_at)) existing.first_seen_at = row.first_seen_at;
      if (new Date(row.last_seen_at) > new Date(existing.last_seen_at)) existing.last_seen_at = row.last_seen_at;
      incidentGroups.set(key, existing);
    }

    return {
      jobs: jobs.rows.map((row) => ({
        job_name: safeLabel(row.job_name, 'unsafe_job_name'),
        last_started_at: row.last_started_at, last_heartbeat_at: row.last_heartbeat_at,
        last_succeeded_at: row.last_succeeded_at, watermark: row.watermark,
        consecutive_failures: count(row.consecutive_failures),
        error_class: row.has_error ? errorClass(row.last_error) : 'none',
      })),
      incidents: [...incidentGroups.values()].sort((a, b) => `${a.kind}|${a.error_class}`.localeCompare(`${b.kind}|${b.error_class}`)),
      queues: Object.fromEntries(Object.entries(queues.rows[0]).map(([key, value]) =>
        ['webhook_due', 'webhook_processing', 'webhook_dead', 'backup_due', 'backup_processing'].includes(key)
          ? [key, count(value)] : [key, value])),
      unallocated_member_payments: memberPayments.rows.map((row) => ({
        ...row, payment_method: safeLabel(row.payment_method, 'unsafe_method'), payment_count: count(row.payment_count),
      })),
      unallocated_platform_payments: platformPayments.rows.map((row) => ({
        ...row, plan: safeLabel(row.plan, 'unsafe_plan'), payment_count: count(row.payment_count),
      })),
    };
  } finally {
    await client.query('rollback');
  }
}

export async function runOperationsAudit(connectionString = process.env.SUPABASE_DB_URL) {
  if (!connectionString) throw new Error('SUPABASE_DB_URL is required');
  const client = new pg.Client({ connectionString, application_name: 'gymflow-operations-audit' });
  await client.connect();
  try { return await operationsSnapshot(client); } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperationsAudit()
    .then((snapshot) => process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`Operations audit failed: ${errorClass(error instanceof Error ? error.message : error)}\n`);
      process.exitCode = 1;
    });
}
