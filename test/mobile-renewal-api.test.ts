import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), renew: vi.fn(), recurring: vi.fn(), rate: vi.fn(),
}));
vi.mock('@/lib/api-app', async (original) => ({ ...await original<typeof import('@/lib/api-app')>(), requireApiMember: mocks.auth }));
vi.mock('@/lib/renew-core', () => ({ startRenewalCore: mocks.renew }));
vi.mock('@/lib/member-auto-renew-core', () => ({ startAutoRenewalCore: mocks.recurring }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/request-origin', () => ({ requestOrigin: async () => 'https://www.gymflow.ng' }));
import { POST } from '@/app/api/app/renew/route';
const ctx = { supabase: {}, user: { id: 'member' }, gym: { id: 'gym' } };
const request = (body: object) => new Request('https://www.gymflow.ng/api/app/renew', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, ctx }); mocks.rate.mockResolvedValue(true);
  mocks.renew.mockResolvedValue({ ok: true, url: 'https://checkout.paystack.com/test', reference: 'one-time' });
  mocks.recurring.mockResolvedValue({ ok: true, url: 'https://checkout.paystack.com/test', reference: 'recurring' });
});
describe('native one-time and recurring checkout parity', () => {
  it('requires authentication before starting either checkout', async () => {
    mocks.auth.mockResolvedValue({ ok: false, res: new Response(null, { status: 401 }) });
    expect((await POST(request({ plan_id: 'plan', auto_renew: true, auto_renew_confirmed: true }))).status).toBe(401);
    expect(mocks.recurring).not.toHaveBeenCalled(); expect(mocks.renew).not.toHaveBeenCalled();
  });
  it('defaults to one-time payment, without silently opening a mandate', async () => {
    const response = await POST(request({ plan_id: 'plan' }));
    expect(await response.json()).toMatchObject({ reference: 'one-time' });
    expect(mocks.renew).toHaveBeenCalledWith(ctx.supabase, ctx.user, ctx.gym, 'plan', false, 'https://www.gymflow.ng/api/app/pay/callback');
    expect(mocks.recurring).not.toHaveBeenCalled();
  });
  it('requires explicit recurring consent before any provider side effect', async () => {
    expect((await POST(request({ plan_id: 'plan', auto_renew: true }))).status).toBe(400);
    expect(mocks.recurring).not.toHaveBeenCalled(); expect(mocks.renew).not.toHaveBeenCalled();
  });
  it('uses trusted identity, the shared mandate guard and the native callback', async () => {
    const response = await POST(request({ plan_id: 'plan', with_trainer: true, auto_renew: true, auto_renew_confirmed: true, member_id: 'attacker', gym_id: 'other' }));
    expect(await response.json()).toMatchObject({ reference: 'recurring' });
    expect(mocks.recurring).toHaveBeenCalledWith(ctx.user, ctx.gym, 'plan', true, 'https://www.gymflow.ng/api/app/pay/callback');
    expect(mocks.renew).not.toHaveBeenCalled();
  });
  it('keeps declined and uncertain checkouts visible without leaking internal errors', async () => {
    mocks.recurring.mockResolvedValue({ ok: false, error: 'Auto-renew is already on.' });
    expect((await POST(request({ plan_id: 'plan', auto_renew: true, auto_renew_confirmed: true }))).status).toBe(422);
    mocks.renew.mockRejectedValue(new Error('private SQL details'));
    const response = await POST(request({ plan_id: 'plan' }));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private');
  });
  it('limits repeated checkout creation', async () => {
    mocks.rate.mockResolvedValue(false);
    expect((await POST(request({ plan_id: 'plan' }))).status).toBe(429);
    expect(mocks.renew).not.toHaveBeenCalled();
  });
});
