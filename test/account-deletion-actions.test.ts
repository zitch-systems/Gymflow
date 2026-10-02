import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), requireAdmin: vi.fn(), rateRpc: vi.fn(), reviewRpc: vi.fn(),
  signIn: vi.fn(), signOut: vi.fn(), createAuth: vi.fn(), request: vi.fn(), read: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/auth/dal', () => ({ getUser: mocks.getUser, requirePlatformAdmin: mocks.requireAdmin }));
vi.mock('@/lib/rate-limit', () => ({ clientIp: async () => '192.0.2.5' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rateRpc }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.reviewRpc }) }));
vi.mock('@/lib/gym-signup', () => ({ createApiAuthClient: () => {
  mocks.createAuth(); return { auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } };
} }));
vi.mock('@/lib/account-deletion', () => ({ getAccountDeletionRequest: mocks.read, requestAccountDeletion: mocks.request }));

import { reviewAccountDeletion, submitAccountDeletion } from '@/lib/actions/account-deletion';

const SUBJECT = 'b1111111-1111-1111-1111-111111111111';
const ADMIN = 'a1111111-1111-1111-1111-111111111111';
const ID = 'd1111111-1111-1111-1111-111111111111';
const receipt = { id: ID, status: 'pending', requested_at: '2026-10-02T00:00:00Z', due_at: '2026-11-01T00:00:00Z', completed_at: null };
const initial = { ok: false, error: null };
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const credentials = { mode: 'credentials', intent: 'request', confirmation: 'DELETE', email: 'member@example.test', password: 'private-password' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: SUBJECT });
  mocks.requireAdmin.mockResolvedValue({ id: ADMIN });
  mocks.rateRpc.mockResolvedValue({ data: true, error: null });
  mocks.reviewRpc.mockResolvedValue({ data: true, error: null });
  mocks.signIn.mockResolvedValue({ data: { user: { id: SUBJECT }, session: { access_token: 'secret-access', refresh_token: 'secret-refresh' } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.request.mockResolvedValue(receipt);
  mocks.read.mockResolvedValue(receipt);
});

describe('public web account deletion', () => {
  it('uses verified cookie identity and ignores caller subject identifiers', async () => {
    const result = await submitAccountDeletion(initial, form({ mode: 'session', confirmation: 'DELETE', subject_id: ADMIN }));
    expect(result.ok).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith(SUBJECT);
    expect(mocks.createAuth).not.toHaveBeenCalled();
  });
  it('does not silently switch an expired cookie session to another account', async () => {
    mocks.getUser.mockResolvedValue(null);
    const result = await submitAccountDeletion(initial, form({ ...credentials, mode: 'session' }));
    expect(result.ok).toBe(false);
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('accepts only intentional requests', async () => {
    const result = await submitAccountDeletion(initial, form({ ...credentials, confirmation: 'delete' }));
    expect(result.ok).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('verifies inactive users without a gym, creates no browser access and revokes only the ephemeral session', async () => {
    const result = await submitAccountDeletion(initial, form(credentials));
    expect(result.ok).toBe(true);
    expect(mocks.signIn).toHaveBeenCalledWith({ email: credentials.email, password: credentials.password });
    expect(mocks.request).toHaveBeenCalledWith(SUBJECT);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(JSON.stringify(result)).not.toMatch(/secret-access|secret-refresh|private-password/);
    expect(mocks.rateRpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.rateRpc.mock.calls)).not.toContain(credentials.email);
  });
  it('checks status without making or changing a request', async () => {
    const result = await submitAccountDeletion(initial, form({ ...credentials, intent: 'status', confirmation: '' }));
    expect(result.ok).toBe(true);
    expect(mocks.read).toHaveBeenCalledWith(SUBJECT);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([{ data: false, error: null }, { data: null, error: { message: 'database unavailable' } }])('fails closed if rate limiting refuses or cannot be checked', async (limit) => {
    mocks.rateRpc.mockResolvedValue(limit);
    expect((await submitAccountDeletion(initial, form(credentials))).ok).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('returns a generic credential error and never creates a request', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'unknown email' } });
    const result = await submitAccountDeletion(initial, form(credentials));
    expect(result.error).toBe('We could not verify that email and password.');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('revokes the ephemeral session even when saving fails', async () => {
    mocks.request.mockRejectedValue(new Error('private persistence error'));
    const result = await submitAccountDeletion(initial, form(credentials));
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('private persistence error');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('platform deletion review action', () => {
  const processing = { request_id: ID, expected_status: 'pending', status: 'processing' };
  it('requires the platform auth boundary before any mutation', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('not platform admin'));
    await expect(reviewAccountDeletion(initial, form(processing))).rejects.toThrow('not platform admin');
    expect(mocks.reviewRpc).not.toHaveBeenCalled();
  });
  it('uses the cookie client with the verified actor, not a caller-supplied actor', async () => {
    expect((await reviewAccountDeletion(initial, form({ ...processing, actor_id: SUBJECT }))).ok).toBe(true);
    expect(mocks.reviewRpc).toHaveBeenCalledWith('review_account_deletion_request', expect.objectContaining({ p_actor_id: ADMIN, p_request_id: ID }));
    expect(mocks.rateRpc).not.toHaveBeenCalled();
  });
  it('refuses completion without both attestations and evidence', async () => {
    expect((await reviewAccountDeletion(initial, form({ request_id: ID, expected_status: 'processing', status: 'completed' }))).ok).toBe(false);
    expect(mocks.reviewRpc).not.toHaveBeenCalled();
  });
  it('reports stale forms without a success message', async () => {
    mocks.reviewRpc.mockResolvedValue({ data: false, error: null });
    const result = await reviewAccountDeletion(initial, form(processing));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('changed');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('sanitizes database errors', async () => {
    mocks.reviewRpc.mockResolvedValue({ data: null, error: { message: 'private SQL detail' } });
    const result = await reviewAccountDeletion(initial, form(processing));
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('private SQL detail');
  });
});
