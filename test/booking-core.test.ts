import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';
const mocks = vi.hoisted(() => ({ notify: vi.fn(), inserts: vi.fn(), active: [] as unknown[], committed: { data: { id: 'new', status: 'booked' }, error: null as { code: string; message: string } | null } }));
vi.mock('@/lib/waiver-core', () => ({ requireWaiverAcceptance: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('no admin fixture'); } }));
import { bookClassCore } from '@/lib/booking-core';

function client() {
  return { from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query,
      insert: (value: unknown) => { (table === 'notifications' ? mocks.notify : mocks.inserts)(value); return query; },
      maybeSingle: async () => table === 'class_schedules'
        ? { data: { id: 'slot', class_id: 'class', day_of_week: 1, start_time: '09:00', classes: { name: 'Class' } }, error: null }
        : { data: mocks.active.shift() ?? null, error: null },
      single: async () => mocks.committed,
      then: (resolve: (result: unknown) => unknown) => resolve({ data: null, error: null }),
    };
    return query;
  } } as unknown as Parameters<typeof bookClassCore>[0];
}
const gym = { id: 'gym', name: 'Gym' } as Database['public']['Tables']['gyms']['Row'];
beforeEach(() => { vi.clearAllMocks(); delete process.env.RESEND_API_KEY; mocks.active = []; mocks.committed = { data: { id: 'new', status: 'booked' }, error: null }; });
describe('booking result follows committed database state', () => {
  it('reports and notifies waitlist when the locked database trigger assigns it', async () => {
    mocks.committed.data.status = 'waitlisted';
    const result = await bookClassCore(client(), 'member', gym, 'slot');
    expect(result.waitlisted).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Added to waitlist' }));
    expect(mocks.inserts).toHaveBeenCalledWith(expect.objectContaining({ status: 'booked' }));
  });
  it('returns the existing active occurrence without writing another booking or notification', async () => {
    mocks.active = [{ id: 'old', status: 'waitlisted' }];
    expect((await bookClassCore(client(), 'member', gym, 'slot')).waitlisted).toBe(true);
    expect(mocks.inserts).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('treats a concurrent duplicate request as the already committed booking', async () => {
    mocks.active = [null, { id: 'concurrent', status: 'booked' }];
    mocks.committed.error = { code: '23505', message: 'duplicate active occurrence' };
    expect((await bookClassCore(client(), 'member', gym, 'slot')).ok).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
