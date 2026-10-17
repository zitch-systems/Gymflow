import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  cancelled: { id: 'booking' } as { id: string } | null,
  candidates: [{ id: 'wait-1', member_id: 'member-1' }, { id: 'wait-2', member_id: 'member-2' }],
  promotions: [null, { id: 'wait-2', status: 'booked' }] as unknown[],
  notify: vi.fn(), adminReads: vi.fn(), statusFilters: [] as unknown[],
}));
vi.mock('@/lib/waiver-core', () => ({ requireWaiverAcceptance: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  let updating = false;
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    update: () => { updating = true; return query; },
    insert: (data: unknown) => { mocks.notify(data); return query; },
    maybeSingle: async () => {
      mocks.adminReads();
      return { data: updating ? mocks.promotions.shift() ?? null : mocks.candidates.shift() ?? null, error: null };
    },
    then: (resolve: (result: unknown) => unknown) => resolve({ data: table === 'notifications' ? [] : null, error: null }),
  };
  return query;
} }) }));
import { cancelBookingCore } from '@/lib/booking-core';
function client() {
  return { from: () => {
    let updating = false;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { if (updating && column === 'status') mocks.statusFilters.push(value); return query; },
      update: () => { updating = true; return query; },
      maybeSingle: async () => ({ data: updating ? mocks.cancelled : {
        id: 'booking', status: 'booked', gym_id: 'gym', class_schedule_id: 'slot', booking_date: '2026-10-20',
      }, error: null }),
    };
    return query;
  } } as unknown as Parameters<typeof cancelBookingCore>[0];
}
beforeEach(() => {
  vi.clearAllMocks(); delete process.env.RESEND_API_KEY;
  mocks.cancelled = { id: 'booking' }; mocks.statusFilters = [];
  mocks.candidates = [{ id: 'wait-1', member_id: 'member-1' }, { id: 'wait-2', member_id: 'member-2' }];
  mocks.promotions = [null, { id: 'wait-2', status: 'booked' }];
});
describe('cancellation and waitlist races', () => {
  it('retries a lost promotion CAS and notifies only the member actually promoted', async () => {
    expect((await cancelBookingCore(client(), 'member', 'booking')).ok).toBe(true);
    expect(mocks.adminReads).toHaveBeenCalledTimes(4);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'member-2' }));
    expect(mocks.statusFilters).toEqual(['booked']);
  });
  it('does not promote when the cancellation lost its status compare-and-swap', async () => {
    mocks.cancelled = null;
    expect((await cancelBookingCore(client(), 'member', 'booking')).ok).toBe(false);
    expect(mocks.adminReads).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('does not send a false promotion alert when capacity trigger keeps the row waitlisted', async () => {
    mocks.promotions = [{ id: 'wait-1', status: 'waitlisted' }];
    expect((await cancelBookingCore(client(), 'member', 'booking')).ok).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
