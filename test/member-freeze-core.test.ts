import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSupabase } from '@/lib/api-app';
const mocks = vi.hoisted(() => ({ sub: null as Record<string, unknown> | null, readError: null as object | null, writeError: null as object | null, saved: true, filters: [] as unknown[][], audit: vi.fn(), writes: 0 }));
function query(write = false) {
  const q = {
    select: () => q, in: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return q; },
    is: (key: string, value: unknown) => { mocks.filters.push([key, value]); return q; },
    update: () => { mocks.writes += 1; return q; },
    maybeSingle: async () => write ? { data: mocks.saved ? { id: 'sub' } : null, error: mocks.writeError } : { data: mocks.sub, error: mocks.readError },
  };
  return q;
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => query(true) }) }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/email/recipients', () => ({ getContact: vi.fn(), getGymStaffEmails: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ platformAppUrl: vi.fn(), sendPlatformEmail: vi.fn() }));
import { memberFreezeWindow, memberMembershipState, requestMemberFreeze } from '@/lib/member-freeze-core';
const client = { from: () => query() } as unknown as AppSupabase;
const gym = { id: 'gym', name: 'Test Gym' };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  mocks.sub = { id: 'sub', status: 'active', start_date: '2026-10-01', end_date: '2026-11-30', paystack_subscription_code: 'private-provider-code', auto_debit_enabled: true };
  mocks.readError = null; mocks.writeError = null; mocks.saved = true; mocks.filters = []; mocks.writes = 0; mocks.audit.mockClear();
  delete process.env.RESEND_API_KEY;
});
afterEach(() => vi.useRealTimers());
describe('member freeze parity and integrity', () => {
  it.each([
    ['2026-02-30', '2026-11-01'], ['2026-10-27', '2026-11-01'], ['2026-10-28', '2026-10-28'],
    ['2026-10-28', '2026-02-30'], ['2026-10-28', '2028-01-01'],
  ])('rejects invalid window %s to %s', (start, end) => expect(memberFreezeWindow(start, end)).toHaveProperty('error'));
  it('uses the WAT day at midnight', () => {
    vi.setSystemTime(new Date('2026-10-28T23:30:00Z'));
    expect(memberFreezeWindow('', '2026-11-01')).toEqual({ start: '2026-10-29', end: '2026-11-01' });
  });
  it('returns public membership controls without provider secrets', async () => {
    const state = await memberMembershipState(client, 'member', gym);
    expect(state.subscription?.auto_renew).toBe(true);
    expect(JSON.stringify(state)).not.toContain('private-provider-code');
    expect(mocks.filters).toContainEqual(['member_id', 'member']);
    expect(mocks.filters).toContainEqual(['gym_id', 'gym']);
  });
  it.each(['paused', 'pause_requested', 'past_due'])('refuses state %s', async (status) => {
    mocks.sub!.status = status;
    expect((await requestMemberFreeze(client, 'member', gym, { start: '', end: '2026-11-02', reason: '' })).ok).toBe(false);
    expect(mocks.writes).toBe(0);
  });
  it('refuses disabled, future and nearly expired memberships', async () => {
    expect((await memberMembershipState(client, 'member', { ...gym, member_freeze_enabled: false })).freeze.can_request).toBe(false);
    mocks.sub!.start_date = '2026-11-01';
    expect((await memberMembershipState(client, 'member', gym)).freeze.can_request).toBe(false);
    mocks.sub!.start_date = '2026-10-01'; mocks.sub!.end_date = '2026-10-30';
    expect((await memberMembershipState(client, 'member', gym)).freeze.can_request).toBe(false);
  });
  it('does not report success or emit an audit when a concurrent change prevents the write', async () => {
    mocks.saved = false;
    const result = await requestMemberFreeze(client, 'member', gym, { start: '', end: '2026-11-02', reason: 'Travel' });
    expect(result.ok).toBe(false); expect(result.error).toMatch(/changed/);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('requires the same owner, gym, status and coverage on the write', async () => {
    const result = await requestMemberFreeze(client, 'member', gym, { start: '', end: '2026-11-02', reason: 'Travel' });
    expect(result.ok).toBe(true); expect(mocks.writes).toBe(1);
    for (const filter of [['id', 'sub'], ['member_id', 'member'], ['gym_id', 'gym'], ['status', 'active'], ['end_date', '2026-11-30'], ['start_date', '2026-10-01']]) expect(mocks.filters).toContainEqual(filter);
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it('surfaces read failures and refuses to write', async () => {
    mocks.readError = { message: 'database details' };
    await expect(requestMemberFreeze(client, 'member', gym, { start: '', end: '2026-11-02', reason: '' })).rejects.toThrow(/could not be loaded/);
    expect(mocks.writes).toBe(0);
  });
});
