import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test invariants in /api/cron/platform-renewals — focused on the parts where
// a regression would actually be expensive: auth gate, no-card → past_due
// flip, and the "email the owner only on the active→past_due transition" rule
// (so we don't spam them every day of the 3-day retry window).

const { state, sendPlatformRenewalFailure } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    dueQueue: Queue;
    perGymQueue: Map<string, Queue>;
    paystackResult: 'success' | 'fail';
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: unknown; refEq?: string }>;
  } = {
    dueQueue: [],
    perGymQueue: new Map(),
    paystackResult: 'success',
    inserts: [],
    updates: [],
  };
  const sendPlatformRenewalFailure = vi.fn(async () => ({ ok: true }));
  return { state, sendPlatformRenewalFailure };
});

// The cron makes many sequential queries against different tables. The mock
// returns a fresh result from a per-table FIFO queue. Inserts/updates are
// tracked so assertions can verify side effects.
const adminMock = {
  from(table: string) {
    const builder: {
      table: string;
      select: () => typeof builder;
      insert: (p: unknown) => typeof builder;
      update: (p: unknown) => typeof builder;
      eq: (col?: string, val?: string) => typeof builder;
      in: () => typeof builder;
      gte: () => typeof builder;
      lte: () => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => typeof builder;
      then: <T>(resolve: (v: unknown) => T) => T;
      _isInsert: boolean;
      _isUpdate: boolean;
      _updatePayload: unknown;
      _lastEqVal?: string;
    } = {
      table,
      _isInsert: false,
      _isUpdate: false,
      _updatePayload: null,
      select() { return builder; },
      insert(p: unknown) {
        state.inserts.push({ table, payload: p });
        builder._isInsert = true;
        return builder;
      },
      update(p: unknown) {
        builder._isUpdate = true;
        builder._updatePayload = p;
        return builder;
      },
      eq(_col?: string, val?: string) {
        if (val) builder._lastEqVal = val;
        return builder;
      },
      in() { return builder; },
      gte() { return builder; },
      lte() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() { return builder; },
      then<T>(resolve: (v: unknown) => T): T {
        if (builder._isUpdate) {
          state.updates.push({ table, payload: builder._updatePayload, refEq: builder._lastEqVal });
          return resolve({ data: null, error: null });
        }
        if (builder._isInsert) {
          return resolve({ data: null, error: null });
        }
        // Reads
        if (table === 'gyms') {
          const next = state.dueQueue.shift() ?? { data: null, error: null };
          return resolve(next);
        }
        const q = state.perGymQueue.get(table);
        const next = q?.shift() ?? { data: null, error: null };
        return resolve(next);
      },
    };
    return builder;
  },
};

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/paystack', () => ({
  paystackFetch: vi.fn(async () => {
    if (state.paystackResult === 'success') {
      return { status: true, data: { status: 'success', reference: 'paystack-ref' } };
    }
    return { status: false, message: 'card declined' };
  }),
}));
vi.mock('@/lib/email', () => ({ sendPlatformRenewalFailure }));

import { GET } from '@/app/api/cron/platform-renewals/route';

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://test.local/api/cron/platform-renewals', { method: 'GET', headers });
}

beforeEach(() => {
  state.dueQueue = [];
  state.perGymQueue = new Map();
  state.paystackResult = 'success';
  state.inserts = [];
  state.updates = [];
  sendPlatformRenewalFailure.mockClear();
  process.env.CRON_SECRET = 'test-cron-secret';
});

const GYM_ACTIVE = {
  id: 'gym-active',
  slug: 'demo',
  name: 'Demo Gym',
  email: 'owner@example.com',
  subscription_plan: 'monthly',
  trial_ends_at: new Date().toISOString(),
  subscription_status: 'active',
};
const GYM_PAST_DUE = { ...GYM_ACTIVE, id: 'gym-past-due', subscription_status: 'past_due' };

describe('GET /api/cron/platform-renewals — auth gate', () => {
  it('rejects requests without the bearer token', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong bearer token', async () => {
    const res = await GET(cronRequest('wrong'));
    expect(res.status).toBe(401);
  });

  it('also accepts the x-vercel-cron-signature header (alt scheme)', async () => {
    state.dueQueue = [{ data: [], error: null }];
    const req = new Request('https://test.local/api/cron/platform-renewals', {
      method: 'GET',
      headers: { 'x-vercel-cron-signature': 'test-cron-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/platform-renewals — failure paths', () => {
  it('only emails the owner on the active→past_due transition (not on every retry)', async () => {
    // Two gyms: one currently 'active' (this is the first failure), one already
    // 'past_due' (second/third retry). Both have a saved card so charge runs.
    state.dueQueue = [{ data: [GYM_ACTIVE, GYM_PAST_DUE], error: null }];
    state.perGymQueue.set('gym_staff_links', [
      { data: { user_id: 'owner-1' }, error: null },
      { data: { user_id: 'owner-2' }, error: null },
    ]);
    state.perGymQueue.set('saved_cards', [
      { data: { authorization_code: 'AUTH_1' }, error: null },
      { data: { authorization_code: 'AUTH_2' }, error: null },
    ]);
    state.perGymQueue.set('platform_payments', [
      { data: null, error: null }, // idempotency miss for gym-active
      { data: null, error: null }, // idempotency miss for gym-past-due
    ]);
    state.paystackResult = 'fail';

    await GET(cronRequest('test-cron-secret'));

    // Exactly one email — for the active→past_due gym. Not for the
    // already-past-due one (would be daily spam).
    expect(sendPlatformRenewalFailure).toHaveBeenCalledTimes(1);
    expect(sendPlatformRenewalFailure).toHaveBeenCalledWith(
      'owner@example.com',
      expect.objectContaining({ gymName: 'Demo Gym' }),
    );

    // The gym row update to past_due also fires only for the transitioning gym.
    const pastDueUpdates = state.updates.filter(
      (u) => u.table === 'gyms' && (u.payload as { subscription_status?: string }).subscription_status === 'past_due',
    );
    expect(pastDueUpdates).toHaveLength(1);
  });

  it('marks a no-card gym past_due AND does NOT charge Paystack', async () => {
    state.dueQueue = [{ data: [GYM_ACTIVE], error: null }];
    state.perGymQueue.set('gym_staff_links', [{ data: { user_id: 'owner-1' }, error: null }]);
    state.perGymQueue.set('saved_cards', [{ data: null, error: null }]); // no card

    await GET(cronRequest('test-cron-secret'));

    // Gym was active, so transition update fires.
    const pastDueUpdates = state.updates.filter(
      (u) => u.table === 'gyms' && (u.payload as { subscription_status?: string }).subscription_status === 'past_due',
    );
    expect(pastDueUpdates).toHaveLength(1);
    // No platform_payments insert (we never reached Paystack).
    expect(state.inserts.filter((i) => i.table === 'platform_payments')).toHaveLength(0);
  });
});

describe('GET /api/cron/platform-renewals — happy path', () => {
  it('successful charge writes platform_payments and updates trial_ends_at', async () => {
    state.dueQueue = [{ data: [GYM_PAST_DUE], error: null }];
    state.perGymQueue.set('gym_staff_links', [{ data: { user_id: 'owner-1' }, error: null }]);
    state.perGymQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perGymQueue.set('platform_payments', [{ data: null, error: null }]); // idempotency miss
    state.paystackResult = 'success';

    await GET(cronRequest('test-cron-secret'));

    // Gym restored to active.
    const restoreUpdate = state.updates.find(
      (u) => u.table === 'gyms' && (u.payload as { subscription_status?: string }).subscription_status === 'active',
    );
    expect(restoreUpdate).toBeDefined();

    // platform_payments insert with the deterministic GFP-... reference.
    const pp = state.inserts.find((i) => i.table === 'platform_payments');
    expect(pp).toBeDefined();
    const payload = pp?.payload as { paystack_reference?: string; payment_status?: string };
    expect(payload.payment_status).toBe('successful');
  });
});
