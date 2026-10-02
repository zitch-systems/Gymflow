import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenClient: null as unknown,
  refreshSession: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mocks.tokenClient),
}));

vi.mock('@/lib/gym-signup', () => ({
  createApiAuthClient: () => ({ auth: { refreshSession: mocks.refreshSession } }),
}));

vi.mock('@/lib/rate-limit', () => ({
  clientIp: vi.fn(async () => '127.0.0.1'),
  rateLimit: vi.fn(async () => true),
}));

import { corsPreflight, requireApiMember } from '@/lib/api-app';
import { POST as refresh } from '@/app/api/app/session/route';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const OLD_GYM = '20000000-0000-4000-8000-000000000001';
const NEW_GYM = '20000000-0000-4000-8000-000000000002';
const WRONG_GYM = '20000000-0000-4000-8000-000000000003';

function gym(id: string, name: string) {
  return { id, name, slug: name.toLowerCase(), subscription_plan: 'growth', legacy_full_access: false };
}

function memberClient(userError: unknown = null) {
  const links = [
    { id: 'old-link', user_id: USER_ID, gym_id: OLD_GYM, is_active: true, joined_at: '2025-01-01', gyms: gym(OLD_GYM, 'Old') },
    { id: 'new-link', user_id: USER_ID, gym_id: NEW_GYM, is_active: true, joined_at: '2026-01-01', gyms: gym(NEW_GYM, 'New') },
  ];
  let requestedGym: string | null = null;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      if (column === 'gym_id') requestedGym = String(value);
      return query;
    }),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: requestedGym ? links.find((link) => link.gym_id === requestedGym) ?? null : links[1],
      error: null,
    })),
  };
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: userError ? null : { id: USER_ID } }, error: userError })) },
    from: vi.fn(() => query),
    query,
  };
}

function request(gymId?: string) {
  const headers: Record<string, string> = { Authorization: 'Bearer access-token' };
  if (gymId !== undefined) headers['X-Gym-Id'] = gymId;
  return new Request('https://example.test/api/app/me', { headers });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  mocks.refreshSession.mockReset();
});

describe('mobile gym scope', () => {
  it('allows X-Gym-Id through CORS', () => {
    expect(corsPreflight().headers.get('Access-Control-Allow-Headers')).toContain('X-Gym-Id');
  });

  it('rejects a malformed gym scope before authentication', async () => {
    mocks.tokenClient = memberClient();
    const result = await requireApiMember(request('not-a-uuid'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.res.status).toBe(400);
  });

  it('uses the exact active owned gym requested by the client', async () => {
    mocks.tokenClient = memberClient();
    const result = await requireApiMember(request(OLD_GYM));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.gym.id).toBe(OLD_GYM);
  });

  it('does not fall back when the requested gym is not owned', async () => {
    mocks.tokenClient = memberClient();
    const result = await requireApiMember(request(WRONG_GYM));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.res.status).toBe(403);
  });

  it('keeps the newest-membership default for old clients', async () => {
    mocks.tokenClient = memberClient();
    const result = await requireApiMember(request());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.gym.id).toBe(NEW_GYM);
  });
});

describe('mobile authentication failures', () => {
  it.each([400, 401, 403])('treats getUser status %s as an invalid credential', async (status) => {
    mocks.tokenClient = memberClient({ status });
    const result = await requireApiMember(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.res.status).toBe(401);
  });

  it.each([[429, 429], [500, 503], [503, 503], [undefined, 503]])(
    'keeps getUser status %s retryable as %s', async (status, expected) => {
      mocks.tokenClient = memberClient({ status });
      const result = await requireApiMember(request());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.res.status).toBe(expected);
        expect(await result.res.json()).toMatchObject({ code: 'retryable' });
      }
    },
  );

  it('returns a retryable 503 when getUser throws a network error', async () => {
    const client = memberClient();
    client.auth.getUser.mockRejectedValue(new Error('fetch failed: internal host'));
    mocks.tokenClient = client;
    const result = await requireApiMember(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(503);
      expect(JSON.stringify(await result.res.json())).not.toContain('internal host');
    }
  });

  it.each([400, 401, 403])('returns 401 for an invalid refresh token (%s)', async (status) => {
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { status } });
    const response = await refresh(new Request('https://example.test/api/app/session', {
      method: 'POST', body: JSON.stringify({ refresh_token: 'stored-refresh-token' }),
    }));
    expect(response.status).toBe(401);
  });

  it.each([[429, 429], [500, 503], [503, 503]])('returns retryable status for refresh error %s', async (status, expected) => {
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { status, message: 'sensitive upstream detail' } });
    const response = await refresh(new Request('https://example.test/api/app/session', {
      method: 'POST', body: JSON.stringify({ refresh_token: 'stored-refresh-token' }),
    }));
    expect(response.status).toBe(expected);
    expect(await response.json()).toEqual({
      error: 'Authentication is temporarily unavailable. Please try again.', code: 'retryable',
    });
  });

  it('returns a retryable 503 when refresh throws a network error', async () => {
    mocks.refreshSession.mockRejectedValue(new Error('fetch failed: internal host'));
    const response = await refresh(new Request('https://example.test/api/app/session', {
      method: 'POST', body: JSON.stringify({ refresh_token: 'stored-refresh-token' }),
    }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('internal host');
  });
});
