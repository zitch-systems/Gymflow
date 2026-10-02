// Production release verification. This script deliberately exposes only
// catalog names, booleans, counts, and non-secret platform defaults. It never
// selects customer rows, Auth identities, storage object names, or backup data.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';

export const EXPECTED_FUNCTIONS = [
  'private.privileged_session_verified()',
  'private.has_gym_role(uuid,user_role[])',
  'private.is_gym_staff(uuid)',
  'private.is_platform_admin()',
  'private.protect_member_payment_coverage()',
  'private.audit_staff_membership_change()',
  'private.protect_platform_payment_coverage()',
  'private.gym_storage_guard_allows(text,text,text)',
  'private.harden_legacy_storage_policies()',
  'public.privileged_session_verified()',
  'public.grant_privileged_session_verification(uuid,uuid,text,uuid)',
  'public.revoke_privileged_session_verification(uuid,uuid)',
  'public.revoke_user_privileged_sessions(uuid)',
  'public.prune_privileged_session_verifications()',
  'public.verify_staff_email_challenge(uuid,text)',
  'public.gym_member_roster(uuid,text,text,integer,integer)',
  'public.gym_reporting_summary(uuid)',
  'public.platform_gym_summary()',
  'public.platform_gym_member_counts(uuid[])',
  'public.platform_commission_summary(timestamp with time zone,timestamp with time zone,integer)',
  'public.record_staff_payment(uuid,uuid,uuid,text,bigint,text,uuid,boolean,text)',
  'public.apply_payment_refund(text,text,text,bigint,text,boolean)',
  'public.settle_member_charge(text,uuid,uuid,uuid,bigint,text,integer,integer,boolean,text,jsonb,uuid)',
  'public.settle_platform_charge(text,uuid,bigint,text,text,text,timestamp with time zone,text,text)',
  'public.reserve_member_auto_renewal(text,uuid,uuid,uuid,bigint,integer,integer,boolean,text)',
  'public.finish_member_auto_renewal_initialization(text,text,boolean,text)',
  'private.mark_auto_renewal_fulfilled()',
  'public.resume_member_freeze(uuid,uuid)',
  'public.set_profile_health_note(uuid,uuid,text,text)',
  'public.consume_whatsapp_email_otp(text,text,text,integer)',
  'public.requeue_payment_webhook_job(text)',
  'public.claim_payment_webhook_jobs(integer,uuid,text)',
];

export const EXPECTED_POLICIES = [
  'public.profile_health_notes.profile_health_notes_read',
  'public.profile_health_note_audit.profile_health_note_audit_read',
  'public.payment_coverage_allocations.coverage_allocations_read',
  'public.staff_financial_operations.staff_financial_operations_read',
  'public.operational_job_state.operational_job_state_platform_read',
  'public.operational_incidents.operational_incidents_platform_read',
  'public.payment_webhook_jobs.payment_webhook_jobs_platform_read',
  'public.gym_backup_jobs.gym_backup_jobs_platform_read',
  'storage.objects.gym_assets_tenant_select',
  'storage.objects.gym_assets_tenant_insert',
  'storage.objects.gym_assets_tenant_update',
  'storage.objects.gym_assets_tenant_delete',
  'storage.objects.gym_backups_owner_manager_read',
  'storage.objects.gym_storage_guard_select',
  'storage.objects.gym_storage_guard_insert',
  'storage.objects.gym_storage_guard_update',
  'storage.objects.gym_storage_guard_delete',
];

export const EXPECTED_RLS_TABLES = [
  'private.privileged_session_verifications',
  'public.profile_health_notes',
  'public.profile_health_note_audit',
  'public.payment_coverage_allocations',
  'public.staff_financial_operations',
  'public.payment_refund_events',
  'public.platform_payment_coverage',
  'public.operational_job_state',
  'public.operational_incidents',
  'public.payment_webhook_jobs',
  'public.gym_backup_jobs',
  'public.paystack_reconciliation_refs',
  'public.member_auto_renewal_intents',
  'storage.objects',
];

const SERVICE_ONLY_FUNCTIONS = [
  'public.grant_privileged_session_verification(uuid,uuid,text,uuid)',
  'public.revoke_privileged_session_verification(uuid,uuid)',
  'public.revoke_user_privileged_sessions(uuid)',
  'public.prune_privileged_session_verifications()',
  'public.verify_staff_email_challenge(uuid,text)',
  'public.consume_whatsapp_email_otp(text,text,text,integer)',
  'public.claim_payment_webhook_jobs(integer,uuid,text)',
  'public.apply_payment_refund(text,text,text,bigint,text,boolean)',
  'public.settle_member_charge(text,uuid,uuid,uuid,bigint,text,integer,integer,boolean,text,jsonb,uuid)',
  'public.settle_platform_charge(text,uuid,bigint,text,text,text,timestamp with time zone,text,text)',
  'public.reserve_member_auto_renewal(text,uuid,uuid,uuid,bigint,integer,integer,boolean,text)',
  'public.finish_member_auto_renewal_initialization(text,text,boolean,text)',
];

const LATEST_RELEASE_MIGRATION = '20261002102547_restrictive_gym_storage_guards.sql';

export function redact(value, secrets = []) {
  let out = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('[REDACTED]');
  }
  return out
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/\b(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_JWT]')
    .replace(/\b(token|secret|password|apikey|authorization)\s*([=:])\s*[^\s,;]+/gi, '$1$2[REDACTED]');
}

export function validateProductionUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('NEXT_PUBLIC_SITE_URL is required');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('NEXT_PUBLIC_SITE_URL must be an absolute URL'); }
  if (url.protocol !== 'https:') throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_SITE_URL must not contain credentials, a query, or a fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

function validateHttpsUrl(raw, name) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`${name} is required`);
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error(`${name} must be an absolute URL`); }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  return url;
}

function configuredSecret(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/^(placeholder|change[-_ ]?me|undefined|null)$/i.test(value.trim());
}

function isCanonical32ByteBase64(value) {
  if (typeof value !== 'string' || value !== value.trim()
    || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}

export function validateProductionEnvironment(env) {
  const checks = {
    secretsEncryptionKey: isCanonical32ByteBase64(env.SECRETS_ENCRYPTION_KEY),
    cronSecret: configuredSecret(env.CRON_SECRET),
    siteUrl: false,
    supabaseUrl: false,
    supabaseAnonKey: configuredSecret(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: configuredSecret(env.SUPABASE_SERVICE_ROLE_KEY),
  };
  try { validateProductionUrl(env.NEXT_PUBLIC_SITE_URL); checks.siteUrl = true; } catch { /* reported below */ }
  try {
    const url = validateHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    checks.supabaseUrl = url.pathname === '/' || url.pathname === '';
  } catch { /* reported below */ }

  const labels = {
    secretsEncryptionKey: 'SECRETS_ENCRYPTION_KEY must be canonical base64 encoding exactly 32 bytes',
    cronSecret: 'CRON_SECRET must be configured',
    siteUrl: 'NEXT_PUBLIC_SITE_URL must be a clean absolute HTTPS URL',
    supabaseUrl: 'NEXT_PUBLIC_SUPABASE_URL must be a clean absolute HTTPS origin',
    supabaseAnonKey: 'NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured',
    supabaseServiceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY must be configured',
  };
  const errors = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => labels[name]);
  return { checks, errors };
}

export function validateDatabaseSnapshot(snapshot) {
  const errors = [];
  if (!Number.isInteger(snapshot.serverMajor) || snapshot.serverMajor < 17) errors.push('Postgres major must be at least 17');
  if (!snapshot.latestMigrationRecorded) errors.push(`migration ledger is missing ${LATEST_RELEASE_MIGRATION}`);
  if (snapshot.missingFunctions.length) errors.push(`missing functions: ${snapshot.missingFunctions.join(', ')}`);
  if (snapshot.missingPolicies.length) errors.push(`missing policies: ${snapshot.missingPolicies.join(', ')}`);
  if (snapshot.rlsDisabled.length) errors.push(`RLS disabled: ${snapshot.rlsDisabled.join(', ')}`);
  for (const [name, present] of Object.entries(snapshot.authPrerequisites)) {
    if (!present) errors.push(`missing Auth prerequisite: ${name}`);
  }
  if (!snapshot.healthNotes.legacyProfileValuesCleared) errors.push('legacy profile health-note values remain');
  if (!snapshot.healthNotes.privateTablesRls) errors.push('health-note tables are not both RLS protected');
  if (snapshot.privilegedProof.directGrantCount !== 0) errors.push('privileged proof table has a direct Data API grant');
  if (!snapshot.privilegedProof.mutationsServiceOnly) errors.push('service-only mutation RPC grants are unsafe');
  if (!snapshot.privilegedProof.authenticatedStatusOnly) errors.push('privileged proof status RPC grants are unsafe');
  if (snapshot.rawPrivilegeLeaks.policyCount !== 0) errors.push('raw staff/platform policy predicate remains');
  if (snapshot.rawPrivilegeLeaks.functionCount !== 0) errors.push('raw staff/platform function predicate remains');
  if (snapshot.storage.gymAssetsPublic !== true) errors.push('gym-assets must remain the public CDN bucket');
  if (snapshot.storage.gymBackupsPublic !== false) errors.push('gym-backups must be private');
  if (!snapshot.storage.canonicalStaffPolicies) errors.push('storage staff policies are not canonical proof-gated helpers');
  if (!snapshot.storage.restrictiveBucketGuards) errors.push('storage bucket guards are not restrictive for anon and authenticated');
  for (const [name, count] of Object.entries(snapshot.operations)) {
    if (!Number.isSafeInteger(count) || count < 0) errors.push(`invalid aggregate metric: ${name}`);
  }
  return errors;
}

export function validateHttpSnapshot(snapshot) {
  const errors = [];
  if (snapshot.publicPage.status !== 200 || !snapshot.publicPage.html || !snapshot.publicPage.gymFlowMarker) {
    errors.push('public application route did not return the GymFlow HTML page');
  }
  if (snapshot.unsignedWebhook.status !== 401) errors.push('unsigned Paystack webhook was not rejected with 401');
  for (const cron of snapshot.crons) {
    if (cron.status < 200 || cron.status >= 300) errors.push(`${cron.name} returned HTTP ${cron.status}`);
  }
  if (snapshot.serviceSettings.available) {
    if (snapshot.serviceSettings.authStatus !== 200) errors.push('Supabase Auth settings check failed');
    if (snapshot.serviceSettings.platformStatus !== 200) errors.push('platform settings check failed');
    if (snapshot.serviceSettings.platformRows !== 1) errors.push('platform settings singleton is missing or duplicated');
  }
  return errors;
}

async function databaseSnapshot(connectionString) {
  const client = new pg.Client({ connectionString, application_name: 'gymflow-release-audit' });
  await client.connect();
  try {
    await client.query('begin read only');
    const version = await client.query(`select current_setting('server_version_num')::integer / 10000 as major`);
    const functions = await client.query(
      `select signature from unnest($1::text[]) signature where to_regprocedure(signature) is null order by signature`,
      [EXPECTED_FUNCTIONS],
    );
    const policies = await client.query(`
        with expected(identity) as (select unnest($1::text[]))
        select identity from expected
        where not exists (
            select 1 from pg_policies p
            where p.schemaname || '.' || p.tablename || '.' || p.policyname = expected.identity
          ) order by identity`, [EXPECTED_POLICIES]);
    const rls = await client.query(`
        with expected(identity) as (select unnest($1::text[]))
        select identity from expected
        left join pg_class c on c.oid=to_regclass(identity)
        where c.oid is null or c.relrowsecurity is not true order by identity`, [EXPECTED_RLS_TABLES]);
    const auth = await client.query(`select
        to_regclass('auth.sessions') is not null as sessions_table,
        exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='id') as sessions_id,
        exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='user_id') as sessions_user_id,
        exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='not_after') as sessions_not_after,
        exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='banned_until') as users_banned_until,
        to_regprocedure('auth.jwt()') is not null as jwt_function`);
    const migration = await client.query(`select exists(
        select 1 from supabase_migrations.repo_migrations where filename=$1
      ) as recorded`, [LATEST_RELEASE_MIGRATION]);
    const health = await client.query(`select
        (select count(*) = 0 from public.profiles where health_notes is not null) as legacy_cleared,
        bool_and(c.relrowsecurity) as private_rls
        from pg_class c where c.oid in ('public.profile_health_notes'::regclass,'public.profile_health_note_audit'::regclass)`);
    const acl = await client.query(`select
        (select count(*)::integer from information_schema.role_table_grants
          where table_schema='private' and table_name='privileged_session_verifications'
            and grantee in ('anon','authenticated','service_role')) as direct_grants,
        (select bool_and(oid is not null
          and has_function_privilege('service_role', oid, 'EXECUTE')
          and not has_function_privilege('authenticated', oid, 'EXECUTE')
          and not has_function_privilege('anon', oid, 'EXECUTE'))
          from (select to_regprocedure(signature) as oid from unnest($1::text[]) signature) functions) as service_only,
        (select oid is not null
          and has_function_privilege('authenticated',oid,'EXECUTE')
          and not has_function_privilege('anon',oid,'EXECUTE')
          from (select to_regprocedure('public.privileged_session_verified()') as oid) status) as status_only`, [SERVICE_ONLY_FUNCTIONS]);
    const rawPolicies = await client.query(`select count(*)::integer as count,
        coalesce(array_agg(schemaname || '.' || tablename || '.' || policyname
          order by schemaname,tablename,policyname), '{}'::text[]) as identities from pg_policies
        where (coalesce(qual,'') || coalesce(with_check,'')) ~ '(gym_staff_links|platform_admins)'
          and (coalesce(qual,'') || coalesce(with_check,'')) not like '%privileged_session_verified%'
          and policyname not in ('gym_staff_links_select_own','pa_select_self')`);
    const rawFunctions = await client.query(`select count(*)::integer as count
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.prokind='f'
          and p.prosrc ~ '(gym_staff_links|platform_admins)'
          and p.prosrc not like '%privileged_session_verified%'
          and p.prosrc !~ 'private\\.(has_gym_role|is_gym_staff|is_platform_admin)'
          and p.proname <> 'handle_new_user'`);
    const buckets = await client.query(`select id,public from storage.buckets where id in ('gym-assets','gym-backups') order by id`);
    const storagePolicies = await client.query(`select count(*)::integer as count from pg_policies
        where schemaname='storage' and tablename='objects'
          and policyname in ('gym_assets_tenant_select','gym_assets_tenant_insert','gym_assets_tenant_update','gym_assets_tenant_delete','gym_backups_owner_manager_read')
          and (coalesce(qual,'') || coalesce(with_check,'')) like '%private.has_gym_role%'`);
    const storageGuards = await client.query(`select count(*)::integer as count
        from pg_policy p where p.polrelid='storage.objects'::regclass
          and not p.polpermissive
          and (select oid from pg_roles where rolname='anon') = any(p.polroles)
          and (select oid from pg_roles where rolname='authenticated') = any(p.polroles)
          and (p.polname,p.polcmd) in (
            ('gym_storage_guard_select','r'),('gym_storage_guard_insert','a'),
            ('gym_storage_guard_update','w'),('gym_storage_guard_delete','d'))
          and (coalesce(pg_get_expr(p.polqual,p.polrelid),'') ||
               coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) like '%private.gym_storage_guard_allows%'`);
    const operations = await client.query(`select
        (select count(*) from public.operational_job_state) as monitored_jobs,
        (select count(*) from public.operational_job_state where last_heartbeat_at is not null) as jobs_with_heartbeat,
        (select count(*) from public.operational_job_state where watermark is not null) as jobs_with_watermark,
        (select count(*) from public.operational_job_state where last_succeeded_at is null) as jobs_never_succeeded,
        (select count(*) from public.operational_incidents where resolved_at is null) as open_incidents,
        (select count(*) from public.payment_webhook_jobs where status in ('queued','retry')) as webhook_due_backlog,
        (select count(*) from public.payment_webhook_jobs where status = 'processing') as webhook_processing,
        (select count(*) from public.payment_webhook_jobs where status = 'dead') as webhook_dead,
        (select count(*) from public.gym_backup_jobs where status in ('queued','retry')) as backup_due_backlog,
        (select count(*) from public.gym_backup_jobs where status = 'processing') as backup_processing,
        (select count(*) from public.member_auto_renewal_intents where state = 'initializing') as auto_renewal_initializing,
        (select count(*) from public.member_auto_renewal_intents where state = 'ready') as auto_renewal_ready,
        (select count(*) from public.payments p where p.payment_status = 'successful'
          and not exists (select 1 from public.payment_coverage_allocations a where a.payment_id = p.id))
          as legacy_unallocated_member_payments,
        (select count(*) from public.platform_payments p where p.payment_status = 'successful'
          and not exists (select 1 from public.platform_payment_coverage a where a.payment_id = p.id))
          as legacy_unallocated_platform_payments`);
    await client.query('rollback');
    const bucketMap = Object.fromEntries(buckets.rows.map((row) => [row.id, row.public]));
    return {
      serverMajor: Number(version.rows[0].major),
      latestMigrationRecorded: migration.rows[0].recorded === true,
      missingFunctions: functions.rows.map((row) => row.signature),
      missingPolicies: policies.rows.map((row) => row.identity),
      rlsDisabled: rls.rows.map((row) => row.identity),
      authPrerequisites: auth.rows[0],
      healthNotes: {
        legacyProfileValuesCleared: health.rows[0].legacy_cleared === true,
        privateTablesRls: health.rows[0].private_rls === true,
      },
      privilegedProof: {
        directGrantCount: acl.rows[0].direct_grants,
        mutationsServiceOnly: acl.rows[0].service_only === true,
        authenticatedStatusOnly: acl.rows[0].status_only === true,
      },
      rawPrivilegeLeaks: { policyCount: rawPolicies.rows[0].count, policyIdentities: rawPolicies.rows[0].identities, functionCount: rawFunctions.rows[0].count },
      storage: {
        gymAssetsPublic: bucketMap['gym-assets'],
        gymBackupsPublic: bucketMap['gym-backups'],
        canonicalStaffPolicies: storagePolicies.rows[0].count === 5,
        restrictiveBucketGuards: storageGuards.rows[0].count === 4,
      },
      operations: Object.fromEntries(Object.entries(operations.rows[0]).map(([name, count]) => [name, Number(count)])),
    };
  } finally {
    await client.end();
  }
}

async function fetchStatus(url, init = {}) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(70_000), ...init });
  return response;
}

async function optionalServiceSettings() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { available: false };
  const supabase = validateProductionUrl(base);
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const authResponse = await fetchStatus(new URL('/auth/v1/settings', supabase), { headers });
  const platformResponse = await fetchStatus(
    new URL('/rest/v1/platform_settings?select=default_commission_pct,default_trial_days&limit=2', supabase),
    { headers },
  );
  let auth = {};
  let platform = [];
  if (authResponse.ok) auth = await authResponse.json();
  if (platformResponse.ok) platform = await platformResponse.json();
  return {
    available: true,
    authStatus: authResponse.status,
    platformStatus: platformResponse.status,
    platformRows: Array.isArray(platform) ? platform.length : 0,
    // Current configuration only; never identities, tokens, or row contents.
    authSummary: authResponse.ok ? {
      signupDisabled: auth.disable_signup === true,
      mailerAutoconfirm: auth.mailer_autoconfirm === true,
      externalProviderCount: Object.values(auth.external ?? {}).filter(Boolean).length,
    } : undefined,
    platformSummary: platformResponse.ok && platform.length === 1 ? {
      defaultCommissionPct: Number(platform[0].default_commission_pct),
      defaultTrialDays: Number(platform[0].default_trial_days),
    } : undefined,
  };
}

async function httpSnapshot(baseUrl, cronSecret) {
  const publicResponse = await fetchStatus(new URL('/', baseUrl));
  const publicBody = await publicResponse.text();
  const webhookResponse = await fetchStatus(new URL('/api/paystack/webhook', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const crons = [];
  for (const [name, path] of [
    ['webhook recovery', '/api/cron/webhook-recovery'],
    ['Paystack reconciliation', '/api/cron/reconcile'],
  ]) {
    const response = await fetchStatus(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    crons.push({ name, status: response.status });
  }
  return {
    releaseCommit: process.env.RELEASE_SHA?.slice(0, 12) || undefined,
    publicPage: {
      status: publicResponse.status,
      html: publicResponse.headers.get('content-type')?.toLowerCase().includes('text/html') === true,
      gymFlowMarker: publicBody.includes('GymFlow'),
    },
    unsignedWebhook: { status: webhookResponse.status },
    crons,
    serviceSettings: await optionalServiceSettings(),
  };
}

function printReport(kind, snapshot) {
  console.log(`${kind} release audit passed`);
  console.log(JSON.stringify(snapshot, null, 2));
}

async function writeSchemaFingerprint(connectionString, outputPath) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('schema fingerprint URL must use PostgreSQL');
  const output = openSync(outputPath, 'w', 0o600);
  try {
    const childEnv = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
      ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
    };
    delete childEnv.FINGERPRINT_DB_URL;
    delete childEnv.SHADOW_DB_URL;
    delete childEnv.LIVE_DB_URL;
    await new Promise((resolvePromise, reject) => {
      const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'scripts/schema-fingerprint.sql'], {
        env: childEnv,
        stdio: ['ignore', output, 'inherit'],
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`schema fingerprint psql failed (${signal ?? `exit ${code}`})`));
      });
    });
  } finally {
    closeSync(output);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'fingerprint') {
    const connectionString = process.env.FINGERPRINT_DB_URL;
    const outputPath = process.env.FINGERPRINT_OUTPUT;
    if (!connectionString || !outputPath) throw new Error('FINGERPRINT_DB_URL and FINGERPRINT_OUTPUT are required');
    await writeSchemaFingerprint(connectionString, outputPath);
    return;
  }
  if (mode === 'database') {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_DB_URL is required');
    const snapshot = await databaseSnapshot(connectionString);
    const errors = validateDatabaseSnapshot(snapshot);
    if (errors.length) {
      console.error('Database release audit snapshot (catalog and aggregates only)');
      console.error(JSON.stringify(snapshot, null, 2));
      throw new Error(errors.join('; '));
    }
    printReport('Database', snapshot);
    return;
  }
  if (mode === 'environment') {
    const snapshot = validateProductionEnvironment(process.env);
    if (snapshot.errors.length) throw new Error(snapshot.errors.join('; '));
    printReport('Production environment', snapshot.checks);
    return;
  }
  if (mode === 'http') {
    const baseUrl = validateProductionUrl(process.env.NEXT_PUBLIC_SITE_URL);
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error('CRON_SECRET is required for authorized recovery checks');
    const snapshot = await httpSnapshot(baseUrl, cronSecret);
    const errors = validateHttpSnapshot(snapshot);
    if (errors.length) throw new Error(errors.join('; '));
    printReport('Production HTTP', snapshot);
    return;
  }
  throw new Error('usage: node scripts/release-audit.mjs <database|environment|fingerprint|http>');
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    const secrets = [
      process.env.SUPABASE_DB_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SECRETS_ENCRYPTION_KEY,
      process.env.CRON_SECRET,
      process.env.VERCEL_TOKEN,
      process.env.FINGERPRINT_DB_URL,
    ];
    try {
      const database = new URL(process.env.SUPABASE_DB_URL ?? '');
      secrets.push(database.username, database.password, database.hostname);
    } catch { /* malformed input is reported without attempting to parse fields */ }
    console.error(`Release audit failed: ${redact(error instanceof Error ? error.message : error, secrets)}`);
    process.exitCode = 1;
  });
}
