import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allowed: true, rate: true, state: vi.fn(), freeze: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/api-app', async (original) => ({ ...await original<typeof import('@/lib/api-app')>(),
  requireApiMember: async () => mocks.allowed ? { ok: true, ctx: { user: { id: 'member' }, gym: { id: 'gym' }, supabase: 'scoped-client' } } : { ok: false, res: new Response('', { status: 401 }) },
}));
vi.mock('@/lib/member-freeze-core', () => ({ memberMembershipState: mocks.state, requestMemberFreeze: mocks.freeze }));
vi.mock('@/lib/member-billing-core', () => ({ disableMemberSubscription: mocks.cancel }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => mocks.rate }));
import { GET, POST, OPTIONS } from '@/app/api/app/membership/route';
const request = (body = {}) => new Request('https://gymflow.ng/api/app/membership', { method: 'POST', body: JSON.stringify(body) });
const sub = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { mocks.allowed = true; mocks.rate = true; vi.clearAllMocks(); mocks.state.mockResolvedValue({ subscription: null }); mocks.freeze.mockResolvedValue({ ok: true }); mocks.cancel.mockResolvedValue({ ok: true }); });
describe('mobile membership management', () => {
  it('requires authentication on reads and writes', async () => { mocks.allowed = false; expect((await GET(request())).status).toBe(401); expect((await POST(request())).status).toBe(401); expect(mocks.state).not.toHaveBeenCalled(); });
  it('uses the same freeze core and trusted gym identity', async () => { await POST(request({ action: 'request_freeze', start: '2026-10-28', end: '2026-11-01', reason: '', gymId: 'foreign' })); expect(mocks.freeze).toHaveBeenCalledWith('scoped-client', 'member', { id: 'gym' }, { start: '2026-10-28', end: '2026-11-01', reason: '' }); });
  it('requires explicit cancellation confirmation', async () => { expect((await POST(request({ action: 'cancel_auto_renew', subscription_id: sub }))).status).toBe(400); expect(mocks.cancel).not.toHaveBeenCalled(); });
  it('always cancels with member authority, regardless of payload role', async () => { await POST(request({ action: 'cancel_auto_renew', subscription_id: sub, confirmed: true, role: 'staff' })); expect(mocks.cancel).toHaveBeenCalledWith(sub, { userId: 'member', gymId: 'gym', role: 'member' }); });
  it('preserves provider failures', async () => { mocks.cancel.mockResolvedValue({ ok: false, error: 'Provider unavailable' }); expect((await POST(request({ action: 'cancel_auto_renew', subscription_id: sub, confirmed: true }))).status).toBe(422); });
  it('does not leak database errors', async () => { mocks.state.mockRejectedValue(new Error('private host')); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private host'); });
  it('limits repeat mutations and supports CORS', async () => { mocks.rate = false; expect((await POST(request({ action: 'request_freeze' }))).status).toBe(429); expect(mocks.freeze).not.toHaveBeenCalled(); expect(OPTIONS().status).toBe(204); });
});
