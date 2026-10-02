import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpSnapshot: vi.fn(), validateHttpSnapshot: vi.fn(), validateProductionEnvironment: vi.fn(),
}));
vi.mock('../scripts/release-audit.mjs', () => ({
  ...mocks,
  validateProductionUrl: (url: string) => new URL(url),
}));

const secret = 'b'.repeat(64);
const commit = 'a'.repeat(40);
const checks = { secretsEncryptionKey: true, cronSecret: true, siteUrl: true, supabaseUrl: true, supabaseAnonKey: true, supabaseServiceRoleKey: true };

function request(authorization = `Bearer ${secret}`, releaseCommit = commit) {
  return new Request('https://www.gymflow.ng/api/internal/release-audit', {
    method: 'POST', headers: { authorization }, body: JSON.stringify({ releaseCommit }),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('GYMFLOW_PRODUCTION_RELEASE', '1');
  vi.stubEnv('RELEASE_AUDIT_SECRET', secret);
  vi.stubEnv('RELEASE_AUDIT_EXPIRES_AT', String(Date.now() + 10 * 60_000));
  vi.stubEnv('RELEASE_SHA', commit);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://gymflow.ng');
  vi.stubEnv('CRON_SECRET', 'runtime-worker-secret');
  mocks.validateProductionEnvironment.mockReturnValue({ checks, errors: [] });
  mocks.validateHttpSnapshot.mockReturnValue([]);
  mocks.httpSnapshot.mockResolvedValue({ publicPage: { status: 200 }, crons: [], serviceSettings: { available: true } });
});
afterEach(() => vi.unstubAllEnvs());

describe('expiring production release audit', () => {
  it('rejects missing/wrong credentials before reading private configuration or running workers', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    for (const authorization of ['', 'Bearer wrong', secret]) {
      expect((await POST(request(authorization))).status).toBe(401);
    }
    expect(mocks.validateProductionEnvironment).not.toHaveBeenCalled();
    expect(mocks.httpSnapshot).not.toHaveBeenCalled();
  });

  it('rejects expired, unbounded, and non-production probes', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    for (const expires of [String(Date.now() - 1), String(Date.now() + 60 * 60_000), 'invalid']) {
      vi.stubEnv('RELEASE_AUDIT_EXPIRES_AT', expires);
      expect((await POST(request())).status).toBe(401);
    }
    vi.stubEnv('RELEASE_AUDIT_EXPIRES_AT', String(Date.now() + 10 * 60_000));
    vi.stubEnv('GYMFLOW_PRODUCTION_RELEASE', '');
    expect((await POST(request())).status).toBe(401);
    expect(mocks.httpSnapshot).not.toHaveBeenCalled();
  });

  it('requires the deployed commit before running workers', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    expect((await POST(request(`Bearer ${secret}`, 'c'.repeat(40)))).status).toBe(409);
    expect(mocks.httpSnapshot).not.toHaveBeenCalled();
  });

  it('validates actual runtime configuration and returns no credential values', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain('runtime-worker-secret');
    expect(JSON.parse(body)).toMatchObject({ releaseCommit: commit, environment: checks, errors: [] });
    expect(mocks.httpSnapshot).toHaveBeenCalledWith(new URL('https://gymflow.ng'), 'runtime-worker-secret');
    expect((await POST(request())).status).toBe(429);
    expect(mocks.httpSnapshot).toHaveBeenCalledTimes(1);
  });

  it('fails closed when runtime keys are placeholders and never calls workers', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    mocks.validateProductionEnvironment.mockReturnValue({ checks: { ...checks, cronSecret: false }, errors: ['CRON_SECRET must be configured'] });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ releaseCommit: commit, errors: ['CRON_SECRET must be configured'] });
    expect(mocks.httpSnapshot).not.toHaveBeenCalled();
  });

  it('withholds provider exceptions and private values on runtime failure', async () => {
    const { POST } = await import('../app/api/internal/release-audit/route');
    mocks.httpSnapshot.mockRejectedValue(new Error('private provider payload and secret'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private provider payload');
  });
});
