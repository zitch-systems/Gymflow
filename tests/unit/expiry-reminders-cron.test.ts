import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invariants worth pinning in /api/cron/expiry-reminders:
//   - the 3-day grace cutoff for "mark expired" — must use lte (today-3), not
//     exact-date. Catches a regression to the original bug where a skipped
//     cron day eternally orphaned that day's expired memberships.
//   - per-window reminder queries: REMINDER_DAYS = [7, 3, 1]. Each window
//     queries memberships with end_date = today + N (exact), so a member
//     gets 3 emails over the lifecycle, not 7.
//   - 'expired' email + status update fire only for rows past the grace
//     cutoff (so day-0 expirations don't get "you expired" while auto-debit
//     is still retrying)

const { state, sendExpiryReminder, sendExpired } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    perTableQueue: Map<string, Queue[]>;
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: unknown }>;
    rangeFilters: Array<{ col: string; bound: 'gte' | 'lte' | 'eq'; val: string }>;
  } = {
    perTableQueue: new Map(),
    inserts: [],
    updates: [],
    rangeFilters: [],
  };
  const sendExpiryReminder = vi.fn(async () => ({ ok: true }));
  const sendExpired = vi.fn(async () => ({ ok: true }));
  return { state, sendExpiryReminder, sendExpired };
});

// The cron does FOUR separate memberships queries:
//   3 reminder windows (eq end_date) + 1 expired sweep (lte end_date)
// Each call to .from('memberships') should pop the next queue.
function takeMembershipsResult(): { data?: unknown; error?: { message: string } | null } {
  const q = state.perTableQueue.get('memberships') ?? [];
  return (q.shift() ?? []).shift() ?? { data: null, error: null };
}

const adminMock = {
  from(table: string) {
    const builder: {
      table: string;
      select: () => typeof builder;
      insert: (p: unknown) => typeof builder;
      update: (p: unknown) => typeof builder;
      eq: (col: string, val: string) => typeof builder;
      lte: (col: string, val: string) => typeof builder;
      limit: () => typeof builder;
      then: <T>(resolve: (v: unknown) => T) => T;
      _isInsert: boolean;
      _isUpdate: boolean;
      _updatePayload: unknown;
      _isMembershipsRead: boolean;
    } = {
      table,
      _isInsert: false,
      _isUpdate: false,
      _updatePayload: null,
      _isMembershipsRead: false,
      select() {
        if (table === 'memberships') builder._isMembershipsRead = true;
        return builder;
      },
      insert(p) {
        state.inserts.push({ table, payload: p });
        builder._isInsert = true;
        return builder;
      },
      update(p) {
        builder._isUpdate = true;
        builder._updatePayload = p;
        return builder;
      },
      eq(col: string, val: string) {
        if (table === 'memberships' && col === 'end_date') {
          state.rangeFilters.push({ col, bound: 'eq', val });
        }
        return builder;
      },
      lte(col: string, val: string) {
        state.rangeFilters.push({ col, bound: 'lte', val });
        return builder;
      },
      limit() { return builder; },
      then<T>(resolve: (v: unknown) => T): T {
        if (builder._isUpdate) {
          state.updates.push({ table, payload: builder._updatePayload });
          return resolve({ data: null, error: null });
        }
        if (builder._isInsert) {
          return resolve({ data: null, error: null });
        }
        if (table === 'memberships' && builder._isMembershipsRead) {
          return resolve(takeMembershipsResult());
        }
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  },
};

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/email', () => ({ sendExpiryReminder, sendExpired }));
vi.mock('@/lib/whatsapp', () => ({
  waExpiryReminder: vi.fn(async () => ({ ok: true })),
}));

import { GET } from '@/app/api/cron/expiry-reminders/route';

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://test.local/api/cron/expiry-reminders', { method: 'GET', headers });
}

// Seed N empty results for the memberships table so the cron's 4 read calls
// (3 reminder windows + 1 expired sweep) all resolve to empty arrays unless
// overridden by the test.
function seedEmptyMembershipsQueue() {
  state.perTableQueue.set('memberships', [
    [{ data: [], error: null }],
    [{ data: [], error: null }],
    [{ data: [], error: null }],
    [{ data: [], error: null }],
  ]);
}

beforeEach(() => {
  state.perTableQueue = new Map();
  state.inserts = [];
  state.updates = [];
  state.rangeFilters = [];
  sendExpiryReminder.mockClear();
  sendExpired.mockClear();
  process.env.CRON_SECRET = 'test-cron-secret';
});

const MEMBER_DUE = (endDate: string) => ({
  id: `m-${endDate}`,
  member_id: `user-${endDate}`,
  gym_id: 'gym-1',
  end_date: endDate,
  auto_renew: true,
  auto_debit_enabled: true,
  gyms: { name: 'Demo Gym', slug: 'demo' },
  profiles: { email: `m+${endDate}@example.com`, phone: '+2348000000000', full_name: 'Mary M.', first_name: 'Mary' },
});

describe('GET /api/cron/expiry-reminders — auth gate', () => {
  it('401 without bearer token', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });
  it('200 with x-vercel-cron-signature alt scheme', async () => {
    seedEmptyMembershipsQueue();
    const req = new Request('https://test.local/api/cron/expiry-reminders', {
      method: 'GET',
      headers: { 'x-vercel-cron-signature': 'test-cron-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/expiry-reminders — query shape', () => {
  it('runs the reminder loop over [7, 3, 1] day windows (exact-date eq) + one expired sweep (lte cutoff)', async () => {
    seedEmptyMembershipsQueue();
    await GET(cronRequest('test-cron-secret'));

    const eqDateFilters = state.rangeFilters.filter((f) => f.col === 'end_date' && f.bound === 'eq');
    const lteDateFilters = state.rangeFilters.filter((f) => f.col === 'end_date' && f.bound === 'lte');
    // 3 eq filters for the 3 reminder windows, 1 lte filter for the sweep.
    expect(eqDateFilters).toHaveLength(3);
    expect(lteDateFilters).toHaveLength(1);
  });

  it('the lte cutoff is BACK-DATED ~3 days (grace window), not equal to today', async () => {
    seedEmptyMembershipsQueue();
    const today = new Date().toISOString().split('T')[0];
    await GET(cronRequest('test-cron-secret'));

    const lteCutoff = state.rangeFilters.find((f) => f.col === 'end_date' && f.bound === 'lte')?.val;
    expect(lteCutoff).toBeDefined();
    expect(lteCutoff).not.toBe(today);
    // ~3 days behind today; sanity-check the day difference.
    const dayDelta = Math.round(
      (new Date(today).getTime() - new Date(lteCutoff!).getTime()) / 86_400_000,
    );
    expect(dayDelta).toBeGreaterThanOrEqual(3);
    expect(dayDelta).toBeLessThanOrEqual(4);
  });
});

describe('GET /api/cron/expiry-reminders — per-window reminders', () => {
  it('sends an expiry reminder for each row in each window (3 windows × 1 row = 3 sends)', async () => {
    const t = new Date();
    const day = (n: number) => new Date(t.getTime() + n * 86_400_000).toISOString().split('T')[0];
    state.perTableQueue.set('memberships', [
      [{ data: [MEMBER_DUE(day(7))], error: null }], // 7-day window
      [{ data: [MEMBER_DUE(day(3))], error: null }], // 3-day window
      [{ data: [MEMBER_DUE(day(1))], error: null }], // 1-day window
      [{ data: [], error: null }], // expired sweep — empty
    ]);

    await GET(cronRequest('test-cron-secret'));

    expect(sendExpiryReminder).toHaveBeenCalledTimes(3);
    // No expired emails because nothing was past the cutoff.
    expect(sendExpired).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/expiry-reminders — expired sweep', () => {
  it('sends an expired email AND marks status=expired for rows past the grace cutoff', async () => {
    const t = new Date();
    const day = (n: number) => new Date(t.getTime() + n * 86_400_000).toISOString().split('T')[0];
    state.perTableQueue.set('memberships', [
      [{ data: [], error: null }], // 7-day window
      [{ data: [], error: null }], // 3-day window
      [{ data: [], error: null }], // 1-day window
      [{ data: [MEMBER_DUE(day(-5)), MEMBER_DUE(day(-10))], error: null }], // 2 expired
    ]);

    await GET(cronRequest('test-cron-secret'));

    expect(sendExpired).toHaveBeenCalledTimes(2);
    // Two memberships.update calls, both with status='expired'.
    const expiredUpdates = state.updates.filter(
      (u) => u.table === 'memberships' && (u.payload as { status?: string }).status === 'expired',
    );
    expect(expiredUpdates).toHaveLength(2);
  });
});
