import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn(), select: vi.fn(), eq: vi.fn(), read: vi.fn(), token: vi.fn() }));
vi.mock('@/lib/api-app', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-app')>(),
  createTokenClient: (token: string) => { mocks.token(token); return { auth: { getUser: mocks.user } }; },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({
  upsert: mocks.upsert,
  select: (columns: string) => { mocks.select(columns); return { eq: (key: string, value: string) => {
    mocks.eq(key, value); return { maybeSingle: mocks.read };
  } }; },
}) }) }));

import { GET, POST, OPTIONS } from '@/app/api/app/account-deletion/route';

const SUBJECT = 'b1111111-1111-1111-1111-111111111111';
const request = { id: 'd1111111-1111-1111-1111-111111111111', status: 'pending', requested_at: '2026-10-02T12:00:00Z', due_at: '2026-11-01T12:00:00Z', completed_at: null };
function req(body?: unknown, token = 'verified-subject-token') {
  return new Request('https://www.gymflow.ng/api/app/account-deletion?subject_id=someone-else', {
    method: body === undefined ? 'GET' : 'POST', headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: SUBJECT } }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.read.mockResolvedValue({ data: request, error: null });
});

describe('account deletion API identity and durability', () => {
  it('rejects missing credentials without touching the queue', async () => {
    expect((await GET(req(undefined, ''))).status).toBe(401);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('verifies the bearer token and scopes every read to its subject, ignoring query identifiers', async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(mocks.user).toHaveBeenCalledWith('verified-subject-token');
    expect(mocks.eq).toHaveBeenCalledWith('subject_id', SUBJECT);
    expect(mocks.select).toHaveBeenCalledWith('id, status, requested_at, due_at, completed_at');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([400, 401, 403])('refuses invalid identity (%s)', async (status) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status } });
    expect((await POST(req({ confirmation: 'DELETE' }))).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each([[429, 429], [500, 503], [undefined, 503]])('preserves transient auth failures (%s)', async (upstream, expected) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: upstream } });
    expect((await GET(req())).status).toBe(expected);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('handles an auth network outage without claiming the session expired', async () => {
    mocks.user.mockRejectedValue(new Error('network failure'));
    expect((await GET(req())).status).toBe(503);
  });
  it.each([{}, { confirmation: 'delete' }, { confirmation: 'DELETE', subject_id: SUBJECT }, { confirmation: 'DELETE', gym_id: 'other' }])('requires exact confirmation and accepts no subject selector', async (body) => {
    expect((await POST(req(body))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('saves a whole-account request even when the user has no gym or plan context', async () => {
    const response = await POST(req({ confirmation: 'DELETE' }));
    expect(response.status).toBe(202);
    expect(mocks.upsert).toHaveBeenCalledWith({ subject_id: SUBJECT }, { onConflict: 'subject_id', ignoreDuplicates: true });
    const body = await response.json();
    expect(body.request).toMatchObject(request);
    expect(body.processing_days).toBe(30);
    expect(body.message).toContain('account stays available');
  });
  it('returns an existing processing receipt unchanged on retry', async () => {
    mocks.read.mockResolvedValue({ data: { ...request, status: 'processing' }, error: null });
    const response = await POST(req({ confirmation: 'DELETE' }));
    expect((await response.json()).request).toMatchObject({ id: request.id, status: 'processing', due_at: request.due_at });
  });
  it('does not report success if persistence fails', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'internal private detail' } });
    const response = await POST(req({ confirmation: 'DELETE' }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('internal private detail');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('requires a readable durable receipt before returning accepted', async () => {
    mocks.read.mockResolvedValue({ data: null, error: null });
    expect((await POST(req({ confirmation: 'DELETE' }))).status).toBe(503);
  });
  it('returns null when no request exists and fails closed on read errors', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: null });
    expect((await (await GET(req())).json()).request).toBeNull();
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });
    expect((await GET(req())).status).toBe(503);
  });
  it('supports preflight without reading any identity', () => {
    expect(OPTIONS().status).toBe(204);
    expect(mocks.user).not.toHaveBeenCalled();
  });
});
