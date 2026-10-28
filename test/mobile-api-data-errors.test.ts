import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fail: '', saved: false, write: vi.fn(), open: vi.fn(async () => null as { id: string; checked_in_at: string } | null), rate: vi.fn(async () => true) }));
vi.mock('@/lib/api-app', async (original) => {
  const actual = await original<typeof import('@/lib/api-app')>();
  return { ...actual, requireApiMember: async () => ({ ok: true, ctx: {
    user: { id: 'member' }, gym: { id: 'gym', name: 'Gym', subscription_plan: 'growth' }, link: {},
    supabase: { from: (table: string) => {
      let single = false, writing = false;
      const query = {
        select: () => query, eq: () => query, neq: () => query, in: () => query,
        gte: () => query, order: () => query, limit: () => query,
        maybeSingle: () => { single = true; return query; },
        update: (patch: unknown) => { writing = true; mocks.write(patch); return query; },
        then: (resolve: (result: unknown) => unknown) => resolve({
          data: table === mocks.fail ? null : writing && mocks.saved ? { id: 'member' } : single ? null : [], count: 0,
          error: table === mocks.fail ? { message: 'private DB hostname and query' } : null,
        }),
      };
      return query;
    } },
  } }) };
});
vi.mock('@/lib/booking-core', () => ({ bookClassCore: vi.fn(), cancelBookingCore: vi.fn() }));
vi.mock('@/lib/checkin-core', () => ({ checkInCore: vi.fn(), checkOutCore: vi.fn(), generateCodeCore: vi.fn(), openVisit: mocks.open }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }));
import { GET as classes, POST as book } from '@/app/api/app/classes/route';
import { GET as checkin } from '@/app/api/app/checkin/route';
import { GET as profile, PATCH as patch } from '@/app/api/app/profile/route';
import { GET as plans } from '@/app/api/app/plans/route';
import { GET as wallet } from '@/app/api/app/wallet/route';
import { GET as notifications } from '@/app/api/app/notifications/route';
import { GET as home } from '@/app/api/app/me/route';
import { GET as receipt } from '@/app/api/app/wallet/[id]/route';

beforeEach(() => { mocks.fail = ''; mocks.saved = false; mocks.write.mockClear(); mocks.rate.mockResolvedValue(true); mocks.open.mockResolvedValue(null); });
const req = () => new Request('https://gymflow.ng/api/app/test');
const cases = [
  { name: 'classes', get: classes, table: 'class_schedules' },
  { name: 'check-in', get: checkin, table: 'check_ins' },
  { name: 'profile', get: profile, table: 'profiles' },
  { name: 'profile subscription', get: profile, table: 'member_subscriptions' },
  { name: 'plans', get: plans, table: 'membership_plans' },
  { name: 'wallet', get: wallet, table: 'payments' },
  { name: 'saved cards', get: wallet, table: 'saved_cards' },
  { name: 'notifications', get: notifications, table: 'notifications' },
  { name: 'home', get: home, table: 'member_subscriptions' },
];
describe('native API data failures', () => {
  it.each(cases)('$name returns retryable failure instead of a fabricated empty success', async ({ get, table }) => {
    mocks.fail = table;
    const response = await get(req());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('retryable');
    expect(JSON.stringify(body)).not.toContain('private');
  });
  it('shows an overnight open visit as checked in even when outside recent history', async () => {
    mocks.open.mockResolvedValue({ id: 'overnight', checked_in_at: '2026-01-01T20:00:00Z' });
    const response = await checkin(req());
    expect(await response.json()).toMatchObject({ checked_in: true, checked_in_at: '2026-01-01T20:00:00Z' });
  });
  it('distinguishes a receipt lookup outage from a nonexistent receipt', async () => {
    mocks.fail = 'payments';
    expect((await receipt(req(), { params: Promise.resolve({ id: 'receipt' }) })).status).toBe(503);
    mocks.fail = '';
    expect((await receipt(req(), { params: Promise.resolve({ id: 'receipt' }) })).status).toBe(404);
  });
  it('rejects impossible and future birth dates without writing a profile', async () => {
    for (const date_of_birth of ['2025-02-30', '2999-01-01']) {
      const response = await patch(new Request('https://gymflow.ng/api/app/profile', { method: 'PATCH', body: JSON.stringify({ full_name: 'Member', date_of_birth }) }));
      expect(response.status).toBe(400);
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('confirms a profile update only when the member row was actually saved', async () => {
    const request = () => new Request('https://gymflow.ng/api/app/profile', { method: 'PATCH', body: JSON.stringify({ full_name: 'Test Member' }) });
    expect((await patch(request())).status).toBe(409);
    mocks.fail = 'profiles';
    const failed = await patch(request());
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('private');
    mocks.fail = ''; mocks.saved = true;
    expect(await (await patch(request())).json()).toEqual({ ok: true });
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({ first_name: 'Test', last_name: 'Member' }));
  });
  it('enforces the same booking/email amplification limit as the web entry point', async () => {
    mocks.rate.mockResolvedValue(false);
    const response = await book(new Request('https://gymflow.ng/api/app/classes', { method: 'POST', body: JSON.stringify({ action: 'book', schedule_id: 'schedule' }) }));
    expect(response.status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith('book:user:member', 30, 60);
  });
});
