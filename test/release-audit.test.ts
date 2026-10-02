import { describe, expect, it } from 'vitest';
import {
  redact, validateDatabaseSnapshot, validateHttpSnapshot, validateProductionEnvironment, validateProductionUrl,
  type DatabaseSnapshot, type HttpSnapshot,
} from '../scripts/release-audit.mjs';

const goodDatabase = (): DatabaseSnapshot => ({
  serverMajor: 17,
  latestMigrationRecorded: true,
  missingFunctions: [],
  missingPolicies: [],
  rlsDisabled: [],
  authPrerequisites: {
    sessions_table: true,
    sessions_id: true,
    sessions_user_id: true,
    sessions_not_after: true,
    users_banned_until: true,
    jwt_function: true,
  },
  healthNotes: { legacyProfileValuesCleared: true, privateTablesRls: true },
  privilegedProof: { directGrantCount: 0, mutationsServiceOnly: true, authenticatedStatusOnly: true },
  rawPrivilegeLeaks: { policyCount: 0, functionCount: 0 },
  storage: { gymAssetsPublic: true, gymBackupsPublic: false, canonicalStaffPolicies: true },
  operations: {
    monitored_jobs: 4,
    jobs_with_heartbeat: 4,
    jobs_with_watermark: 2,
    jobs_never_succeeded: 0,
    open_incidents: 0,
    webhook_due_backlog: 0,
    webhook_processing: 0,
    webhook_dead: 0,
    backup_due_backlog: 0,
    backup_processing: 0,
    auto_renewal_initializing: 0,
    auto_renewal_ready: 0,
    legacy_unallocated_member_payments: 0,
    legacy_unallocated_platform_payments: 0,
  },
});

const goodHttp = (): HttpSnapshot => ({
  publicPage: { status: 200, html: true, gymFlowMarker: true },
  unsignedWebhook: { status: 401 },
  crons: [{ name: 'webhook recovery', status: 200 }, { name: 'Paystack reconciliation', status: 200 }],
  serviceSettings: { available: true, authStatus: 200, platformStatus: 200, platformRows: 1 },
});

describe('release-audit redaction', () => {
  it('removes exact secrets, connection credentials, bearer tokens, JWTs, and key assignments', () => {
    const secret = 'cron-secret-value';
    const jwt = 'eyJabcdefgh.eyJijklmnop.signature123';
    const input = `secret=${secret} Bearer ${secret} postgresql://postgres:hunter2@db.example/x token=abc123 ${jwt}`;
    const output = redact(input, [secret]);
    expect(output).not.toContain(secret);
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('abc123');
    expect(output).not.toContain(jwt);
    expect(output).toContain('postgresql://[REDACTED]@db.example/x');
  });

  it('does not hide ordinary catalog names and counts', () => {
    expect(redact('missing function public.record_staff_payment count=2'))
      .toBe('missing function public.record_staff_payment count=2');
  });
});

describe('release-audit validation', () => {
  it('accepts only a clean production URL', () => {
    expect(validateProductionUrl('https://gymflow.ng/').href).toBe('https://gymflow.ng/');
    expect(() => validateProductionUrl('http://gymflow.ng')).toThrow(/HTTPS/);
    expect(() => validateProductionUrl('https://user:pass@gymflow.ng')).toThrow(/credentials/);
    expect(() => validateProductionUrl('https://gymflow.ng/?token=x')).toThrow(/query/);
  });

  it('accepts a complete production environment without returning any values', () => {
    const secretKey = Buffer.alloc(32, 7).toString('base64');
    const cronSecret = 'cron-secret-never-print';
    const serviceRole = 'service-role-never-print';
    const snapshot = validateProductionEnvironment({
      SECRETS_ENCRYPTION_KEY: secretKey,
      CRON_SECRET: cronSecret,
      NEXT_PUBLIC_SITE_URL: 'https://gymflow.ng',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-never-print',
      SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    });
    expect(snapshot.errors).toEqual([]);
    expect(Object.values(snapshot.checks)).toEqual([true, true, true, true, true, true]);
    expect(JSON.stringify(snapshot)).not.toContain(secretKey);
    expect(JSON.stringify(snapshot)).not.toContain(cronSecret);
    expect(JSON.stringify(snapshot)).not.toContain(serviceRole);
  });

  it('rejects malformed encryption keys, unsafe URLs, placeholders, and absent secrets by name only', () => {
    const snapshot = validateProductionEnvironment({
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64'),
      CRON_SECRET: '',
      NEXT_PUBLIC_SITE_URL: 'http://gymflow.ng',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/rest/v1',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'change-me',
    });
    expect(Object.values(snapshot.checks)).toEqual([false, false, false, false, false, false]);
    expect(snapshot.errors).toHaveLength(6);
    expect(snapshot.errors.join(' ')).not.toContain(Buffer.alloc(31).toString('base64'));
  });

  it('accepts the complete catalog snapshot', () => {
    expect(validateDatabaseSnapshot(goodDatabase())).toEqual([]);
  });

  it('reports security drift without including row data', () => {
    const snapshot = goodDatabase();
    snapshot.missingFunctions = ['private.privileged_session_verified()'];
    snapshot.rlsDisabled = ['public.profile_health_notes'];
    snapshot.privilegedProof.directGrantCount = 1;
    snapshot.storage.gymBackupsPublic = true;
    expect(validateDatabaseSnapshot(snapshot)).toEqual([
      'missing functions: private.privileged_session_verified()',
      'RLS disabled: public.profile_health_notes',
      'privileged proof table has a direct Data API grant',
      'gym-backups must be private',
    ]);
  });

  it('rejects invalid aggregate metrics while allowing nonzero operational counts', () => {
    const snapshot = goodDatabase();
    snapshot.operations.webhook_due_backlog = 12;
    snapshot.operations.legacy_unallocated_member_payments = 3;
    expect(validateDatabaseSnapshot(snapshot)).toEqual([]);
    snapshot.operations.webhook_dead = -1;
    expect(validateDatabaseSnapshot(snapshot)).toEqual(['invalid aggregate metric: webhook_dead']);
  });

  it('requires the public route, unsigned rejection, authorized crons, and optional settings checks', () => {
    expect(validateHttpSnapshot(goodHttp())).toEqual([]);
    const bad = goodHttp();
    bad.unsignedWebhook.status = 200;
    bad.crons[1].status = 500;
    bad.serviceSettings.platformRows = 2;
    expect(validateHttpSnapshot(bad)).toEqual([
      'unsigned Paystack webhook was not rejected with 401',
      'Paystack reconciliation returned HTTP 500',
      'platform settings singleton is missing or duplicated',
    ]);
  });

  it('allows service-only settings checks to be absent', () => {
    const snapshot = goodHttp();
    snapshot.serviceSettings = { available: false };
    expect(validateHttpSnapshot(snapshot)).toEqual([]);
  });
});
