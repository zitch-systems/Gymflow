import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ result: { data: { id: 'session' } as { id: string } | null, error: null as { message: string } | null }, revalidate: vi.fn(), filters: [] as unknown[][] }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/auth/dal', () => ({ requireInstructor: async () => ({ user: { id: 'coach' }, gym: { id: 'gym' } }) }));
vi.mock('@/lib/auth/actions', () => ({ verifyPassword: vi.fn() }));
vi.mock('@/lib/paystack', () => ({ resolveAccount: vi.fn() }));
vi.mock('@/lib/payout-alerts', () => ({ alertInstructorBankChanged: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => {
  const query = {
    from: () => query, update: () => query, select: () => query,
    eq: (...args: unknown[]) => { mocks.filters.push(args); return query; },
    neq: (...args: unknown[]) => { mocks.filters.push(['not', ...args]); return query; },
    maybeSingle: async () => mocks.result,
  };
  return query;
} }));
import { markSession } from '@/lib/actions/instructor';
beforeEach(() => { mocks.result = { data: { id: 'session' }, error: null }; mocks.filters = []; mocks.revalidate.mockClear(); });
describe('coach attendance authorization', () => {
  it('rejects invalid runtime status values before writing', async () => {
    expect((await markSession('session', 'scheduled' as 'completed')).ok).toBe(false);
    expect(mocks.filters).toEqual([]);
  });
  it('does not claim a missing or inaccessible session was marked', async () => {
    mocks.result.data = null;
    expect((await markSession('session', 'completed')).ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('scopes marks to this coach and gym and excludes cancelled sessions', async () => {
    expect((await markSession('session', 'no_show')).ok).toBe(true);
    expect(mocks.filters).toEqual(expect.arrayContaining([['id', 'session'], ['instructor_id', 'coach'], ['gym_id', 'gym'], ['not', 'status', 'cancelled']]));
    expect(mocks.revalidate).toHaveBeenCalledWith('/coach/attendance');
  });
});
