import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  httpSnapshot, redact, remoteSnapshot, resolveProductionOrigin, validateDatabaseSnapshot, validateHttpSnapshot,
  validateProductionEnvironment, validateProductionUrl,
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
  storage: { gymAssetsPublic: true, gymBackupsPublic: false, canonicalStaffPolicies: true, restrictiveBucketGuards: true },
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('production HTTP origin', () => {
  it('resolves apex/www redirects and rejects another origin before sending credentials', () => {
    const base = new URL('https://gymflow.ng');
    expect(resolveProductionOrigin(base, 'https://www.gymflow.ng/').origin).toBe('https://www.gymflow.ng');
    expect(resolveProductionOrigin(new URL('https://www.gymflow.ng'), 'https://gymflow.ng/').origin)
      .toBe('https://gymflow.ng');
    for (const url of ['https://attacker.example/', 'https://tenant.gymflow.ng/', 'https://gymflow.ng:8443/', 'http://gymflow.ng/']) {
      expect(() => resolveProductionOrigin(base, url)).toThrow();
    }
  });

  it('sends the worker bearer directly to the canonical origin and forbids redirects', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const publicResponse = new Response('<html>GymFlow</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(publicResponse, 'url', { value: 'https://www.gymflow.ng/' });
    const fetch = vi.fn()
      .mockResolvedValueOnce(publicResponse)
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const snapshot = await httpSnapshot(new URL('https://gymflow.ng'), 'test-cron-credential');
    expect(validateHttpSnapshot(snapshot)).toEqual([]);
    expect(snapshot.publicPage.canonicalOrigin).toBe('https://www.gymflow.ng');
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(fetch.mock.calls.slice(1).map(([url]) => url.origin))
      .toEqual(['https://www.gymflow.ng', 'https://www.gymflow.ng', 'https://www.gymflow.ng']);
    for (const [, init] of fetch.mock.calls.slice(2)) {
      expect(init).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer test-cron-credential' } });
    }
  });

  it('does not send worker credentials after a redirect to an untrusted domain', async () => {
    const response = new Response('<html>GymFlow</html>', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://attacker.example/' });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    await expect(httpSnapshot(new URL('https://gymflow.ng'), 'test-cron-credential'))
      .rejects.toThrow(/outside the configured production domain/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it('checks service settings with a new secret API key without treating it as a JWT', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test-never-print');
    const publicResponse = new Response('<html>GymFlow</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(publicResponse, 'url', { value: 'https://www.gymflow.ng/' });
    const fetch = vi.fn()
      .mockResolvedValueOnce(publicResponse)
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(Response.json({ disable_signup: false }))
      .mockResolvedValueOnce(Response.json([{ default_commission_pct: 5, default_trial_days: 14 }]));
    vi.stubGlobal('fetch', fetch);
    const snapshot = await httpSnapshot(new URL('https://gymflow.ng'), 'test-cron-credential');
    expect(validateHttpSnapshot(snapshot)).toEqual([]);
    for (const [, init] of fetch.mock.calls.slice(4)) {
      expect(init).toMatchObject({ redirect: 'error', headers: { apikey: 'sb_secret_test-never-print' } });
      expect(init.headers.authorization).toBeUndefined();
    }
  });

  it('preserves safe runtime diagnostics when environment validation returns 503 without HTTP results', async () => {
    const releaseCommit = 'a'.repeat(40);
    const publicResponse = new Response('<html>GymFlow</html>', { status: 200 });
    Object.defineProperty(publicResponse, 'url', { value: 'https://www.gymflow.ng/' });
    const fetch = vi.fn().mockResolvedValueOnce(publicResponse).mockResolvedValueOnce(Response.json({
      releaseCommit,
      environment: { secretsEncryptionKey: false, cronSecret: true, siteUrl: true, supabaseUrl: true, supabaseAnonKey: true, supabaseServiceRoleKey: true },
      errors: ['SECRETS_ENCRYPTION_KEY must be canonical base64 encoding exactly 32 bytes'],
    }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const result = await remoteSnapshot(new URL('https://gymflow.ng'), 'release-credential', releaseCommit);
    expect(result.errors).toEqual([
      'SECRETS_ENCRYPTION_KEY must be canonical base64 encoding exactly 32 bytes',
      'runtime production environment validation failed',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer release-credential' } });
  });
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

  it('rejects protected-value placeholders and surrounding whitespace', () => {
    for (const value of ['[SENSITIVE]', '[REDACTED]', ' credential ', 'credential\n']) {
      const snapshot = validateProductionEnvironment({ CRON_SECRET: value, SUPABASE_SERVICE_ROLE_KEY: value });
      expect(snapshot.checks.cronSecret).toBe(false);
      expect(snapshot.checks.supabaseServiceRoleKey).toBe(false);
      expect(snapshot.errors.join(' ')).not.toContain(value);
    }
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

  it('rejects permissive or missing bucket guards even when canonical policies exist', () => {
    const snapshot = goodDatabase();
    snapshot.storage.restrictiveBucketGuards = false;
    expect(validateDatabaseSnapshot(snapshot)).toEqual([
      'storage bucket guards are not restrictive for anon and authenticated',
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
