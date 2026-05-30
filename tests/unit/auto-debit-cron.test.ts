import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invariants in /api/cron/auto-debit — the daily member-renewal path. Highest-
// volume money path in the system: a regression here means double-charges, lost
// renewals, or worse. Targeted scenarios that match the failure modes we
// actually fixed during the audit:
//
//   - the "double cron run double-charges" race → same-day idempotency guard
//   - the "failed charge silently extended end_date for 3 days" bug → never
//     touch end_date on failure
//   - the 3-day retry window via [today-2 .. today], not exact-date match

const { state, sendAutoDebitSuccess, sendAutoDebitFailure } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    dueQueue: Queue;
    perTableQueue: Map<string, Queue>;
    paystackResult: 'success' | 'fail';
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: unknown }>;
    rangeFilters: Array<{ col: string; bound: 'gte' | 'lte'; val: string }>;
    eqFilters: Array<{ table: string; col: string; val: unknown }>;
  } = {
    dueQueue: [],
    perTableQueue: new Map(),
    paystackResult: 'success',
    inserts: [],
    updates: [],
    rangeFilters: [],
    eqFilters: [],
  };
  const sendAutoDebitSuccess = vi.fn(async () => ({ ok: true }));
  const sendAutoDebitFailure = vi.fn(async () => ({ ok: true }));
  return { state, sendAutoDebitSuccess, sendAutoDebitFailure };
});

const adminMock = {
  from(table: string) {
    const builder: {
      table: string;
      select: () => typeof builder;
      insert: (p: unknown) => typeof builder;
      update: (p: unknown) => typeof builder;
      eq: (col: string, val: unknown) => typeof builder;
      gte: (col: string, val: string) => typeof builder;
      lte: (col: string, val: string) => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => typeof builder;
      then: <T>(resolve: (v: unknown) => T) => T;
      _isInsert: boolean;
      _isUpdate: boolean;
      _updatePayload: unknown;
    } = {
      table,
      _isInsert: false,
      _isUpdate: false,
      _updatePayload: null,
      select() { return builder; },
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
      eq(col: string, val: unknown) { state.eqFilters.push({ table, col, val }); return builder; },
      gte(col: string, val: string) {
        state.rangeFilters.push({ col, bound: 'gte', val });
        return builder;
      },
      lte(col: string, val: string) {
        state.rangeFilters.push({ col, bound: 'lte', val });
        return builder;
      },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() { return builder; },
      then<T>(resolve: (v: unknown) => T): T {
        if (builder._isUpdate) {
          state.updates.push({ table, payload: builder._updatePayload });
          return resolve({ data: null, error: null });
        }
        if (builder._isInsert) {
          return resolve({ data: null, error: null });
        }
        if (table === 'memberships') {
          const next = state.dueQueue.shift() ?? { data: null, error: null };
          return resolve(next);
        }
        const q = state.perTableQueue.get(table);
        return resolve(q?.shift() ?? { data: null, error: null });
      },
    };
    return builder;
  },
};

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/paystack', () => ({
  paystackFetch: vi.fn(async () => {
    if (state.paystackResult === 'success') {
      return { data: { status: 'success', reference: 'paystack-ref' } };
    }
    throw new Error('card declined');
  }),
}));
vi.mock('@/lib/email', () => ({ sendAutoDebitSuccess, sendAutoDebitFailure }));
vi.mock('@/lib/whatsapp', () => ({
  waAutoDebitSuccess: vi.fn(async () => ({ ok: true })),
  waAutoDebitFailure: vi.fn(async () => ({ ok: true })),
}));

import { GET } from '@/app/api/cron/auto-debit/route';

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://test.local/api/cron/auto-debit', { method: 'GET', headers });
}

beforeEach(() => {
  state.dueQueue = [];
  state.perTableQueue = new Map();
  state.paystackResult = 'success';
  state.inserts = [];
  state.updates = [];
  state.rangeFilters = [];
  state.eqFilters = [];
  sendAutoDebitSuccess.mockClear();
  sendAutoDebitFailure.mockClear();
  process.env.CRON_SECRET = 'test-cron-secret';
});

const MEMBER_DUE = {
  id: 'm-1',
  member_id: 'user-1',
  gym_id: 'gym-1',
  end_date: '2026-05-28',
  plan_id: 'plan-1',
  auto_debit_enabled: true,
  gyms: { slug: 'demo', name: 'Demo Gym' },
  profiles: { email: 'm@example.com', full_name: 'Mary M.', first_name: 'Mary', phone: '+2348000000000' },
  membership_plans: { name: 'Monthly', price: 20000, duration_months: 1 },
};

describe('GET /api/cron/auto-debit — auth gate', () => {
  it('401 without the bearer token', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });
  it('401 with the wrong bearer token', async () => {
    const res = await GET(cronRequest('nope'));
    expect(res.status).toBe(401);
  });
  it('200 with x-vercel-cron-signature alt scheme', async () => {
    state.dueQueue = [{ data: [], error: null }];
    const req = new Request('https://test.local/api/cron/auto-debit', {
      method: 'GET',
      headers: { 'x-vercel-cron-signature': 'test-cron-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/auto-debit — retry window', () => {
  it('queries memberships in a 3-day [today-2 .. today] window, not exact-date match', async () => {
    state.dueQueue = [{ data: [], error: null }];
    await GET(cronRequest('test-cron-secret'));

    // Should have set gte + lte on end_date (not just .eq) so a skipped cron
    // day still picks up yesterday's expirations.
    const endDateFilters = state.rangeFilters.filter((f) => f.col === 'end_date');
    expect(endDateFilters.some((f) => f.bound === 'gte')).toBe(true);
    expect(endDateFilters.some((f) => f.bound === 'lte')).toBe(true);
  });
});

describe('GET /api/cron/auto-debit — idempotency', () => {
  it('skips a member who was already charged today (double cron run guard)', async () => {
    state.dueQueue = [{ data: [MEMBER_DUE], error: null }];
    state.perTableQueue.set('saved_cards', [{ data: [{ authorization_code: 'AUTH_1' }], error: null }]);
    state.perTableQueue.set('payments', [
      { data: { id: 'already-charged' }, error: null }, // idempotency HIT
    ]);

    await GET(cronRequest('test-cron-secret'));

    // No Paystack charge, no membership end_date update, no payment insert.
    expect(state.updates.filter((u) => u.table === 'memberships')).toHaveLength(0);
    expect(state.inserts.filter((i) => i.table === 'payments')).toHaveLength(0);
    expect(sendAutoDebitSuccess).not.toHaveBeenCalled();
  });

  it('scopes the idempotency guard to this membership plan, not any same-day card charge', async () => {
    // Regression: without the plan_id scope the guard matched any card charge
    // for the member that day — so a member who also auto-renews a PT /
    // instructor subscription (plan_id null, different cron) would have their
    // membership renewal silently skipped, or vice-versa.
    state.dueQueue = [{ data: [MEMBER_DUE], error: null }];
    state.perTableQueue.set('saved_cards', [{ data: [{ authorization_code: 'AUTH_1' }], error: null }]);
    state.perTableQueue.set('payments', [{ data: null, error: null }]);

    await GET(cronRequest('test-cron-secret'));

    const guardPlanFilter = state.eqFilters.find((f) => f.table === 'payments' && f.col === 'plan_id');
    expect(guardPlanFilter).toBeDefined();
    expect(guardPlanFilter?.val).toBe('plan-1');
  });
});

describe('GET /api/cron/auto-debit — failure path', () => {
  it('does NOT mutate end_date on a failed charge (the "free 3-day extension" regression)', async () => {
    state.dueQueue = [{ data: [MEMBER_DUE], error: null }];
    state.perTableQueue.set('saved_cards', [{ data: [{ authorization_code: 'AUTH_1' }], error: null }]);
    state.perTableQueue.set('payments', [
      { data: null, error: null }, // idempotency miss → proceed to charge
    ]);
    state.paystackResult = 'fail';

    await GET(cronRequest('test-cron-secret'));

    // No memberships update — failed charge must leave end_date alone so the
    // row stays in the [end_date .. end_date+2] retry window for tomorrow's run.
    expect(state.updates.filter((u) => u.table === 'memberships')).toHaveLength(0);
    // Failure notification fires.
    expect(sendAutoDebitFailure).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/cron/auto-debit — happy path', () => {
  it('successful charge extends end_date and inserts a successful payment', async () => {
    state.dueQueue = [{ data: [MEMBER_DUE], error: null }];
    state.perTableQueue.set('saved_cards', [{ data: [{ authorization_code: 'AUTH_1' }], error: null }]);
    state.perTableQueue.set('payments', [
      { data: null, error: null }, // idempotency miss → proceed
    ]);
    state.paystackResult = 'success';

    await GET(cronRequest('test-cron-secret'));

    // memberships.update for the new end_date
    const memUpdate = state.updates.find((u) => u.table === 'memberships');
    expect(memUpdate).toBeDefined();
    expect((memUpdate?.payload as { end_date?: string }).end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // payments insert at the plan price, with payment_method='card'
    const payIns = state.inserts.find((i) => i.table === 'payments');
    expect(payIns).toBeDefined();
    expect(payIns?.payload).toMatchObject({
      amount: 20000,
      currency: 'NGN',
      payment_method: 'card',
      payment_status: 'successful',
    });
    expect(sendAutoDebitSuccess).toHaveBeenCalledTimes(1);
  });
});
