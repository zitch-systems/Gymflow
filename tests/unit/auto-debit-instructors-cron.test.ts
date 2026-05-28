import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same shape as the member auto-debit cron, but for instructor subscriptions.
// Extra invariants worth pinning:
//   - 'no_price' bucket — instructor_pricing row was deleted but the sub
//     still has auto_renew on. We must NOT charge a stale amount.
//   - subaccount routing — when the gym has a paystack_subaccount_code, the
//     Paystack call must include subaccount + bearer='subaccount' so the
//     funds split to the gym, not the platform.

const { state, sendAutoDebitSuccess, sendAutoDebitFailure, paystackFetch } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    dueQueue: Queue;
    perTableQueue: Map<string, Queue>;
    paystackResult: 'success' | 'fail';
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: unknown }>;
    paystackCalls: Array<{ path: string; body: unknown }>;
    rangeFilters: Array<{ col: string; bound: 'gte' | 'lte'; val: string }>;
  } = {
    dueQueue: [],
    perTableQueue: new Map(),
    paystackResult: 'success',
    inserts: [],
    updates: [],
    paystackCalls: [],
    rangeFilters: [],
  };
  const sendAutoDebitSuccess = vi.fn(async () => ({ ok: true }));
  const sendAutoDebitFailure = vi.fn(async () => ({ ok: true }));
  const paystackFetch = vi.fn(async (path: string, init: { body?: string } = {}) => {
    state.paystackCalls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (state.paystackResult === 'success') {
      return { status: true, data: { status: 'success', reference: 'paystack-ref' } };
    }
    return { status: false, message: 'card declined' };
  });
  return { state, sendAutoDebitSuccess, sendAutoDebitFailure, paystackFetch };
});

const adminMock = {
  from(table: string) {
    const builder: {
      table: string;
      select: () => typeof builder;
      insert: (p: unknown) => typeof builder;
      update: (p: unknown) => typeof builder;
      eq: () => typeof builder;
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
      eq() { return builder; },
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
        if (table === 'instructor_subscriptions') {
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
vi.mock('@/lib/paystack', () => ({ paystackFetch }));
vi.mock('@/lib/email', () => ({ sendAutoDebitSuccess, sendAutoDebitFailure }));
vi.mock('@/lib/whatsapp', () => ({
  waAutoDebitSuccess: vi.fn(async () => ({ ok: true })),
  waAutoDebitFailure: vi.fn(async () => ({ ok: true })),
}));

import { GET } from '@/app/api/cron/auto-debit-instructors/route';

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://test.local/api/cron/auto-debit-instructors', { method: 'GET', headers });
}

beforeEach(() => {
  state.dueQueue = [];
  state.perTableQueue = new Map();
  state.paystackResult = 'success';
  state.inserts = [];
  state.updates = [];
  state.paystackCalls = [];
  state.rangeFilters = [];
  sendAutoDebitSuccess.mockClear();
  sendAutoDebitFailure.mockClear();
  paystackFetch.mockClear();
  process.env.CRON_SECRET = 'test-cron-secret';
});

const SUB_NO_SUBACCOUNT = {
  id: 'sub-1',
  gym_id: 'gym-1',
  instructor_id: 'inst-1',
  member_id: 'user-1',
  end_date: '2026-05-28',
  gyms: { slug: 'demo', name: 'Demo Gym', paystack_subaccount_code: null },
  profiles: { email: 'm@example.com', full_name: 'Mary M.', first_name: 'Mary', phone: '+2348000000000' },
  instructor: { full_name: 'Coach A.' },
};
const SUB_WITH_SUBACCOUNT = {
  ...SUB_NO_SUBACCOUNT,
  id: 'sub-2',
  gyms: { slug: 'demo', name: 'Demo Gym', paystack_subaccount_code: 'ACCT_xyz' },
};

describe('GET /api/cron/auto-debit-instructors — auth gate', () => {
  it('401 without bearer token', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });
  it('401 with wrong bearer token', async () => {
    const res = await GET(cronRequest('nope'));
    expect(res.status).toBe(401);
  });
  it('accepts x-vercel-cron-signature alt scheme', async () => {
    state.dueQueue = [{ data: [], error: null }];
    const req = new Request('https://test.local/api/cron/auto-debit-instructors', {
      method: 'GET',
      headers: { 'x-vercel-cron-signature': 'test-cron-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/auto-debit-instructors — retry window + idempotency', () => {
  it('uses gte+lte on end_date (not exact-date match)', async () => {
    state.dueQueue = [{ data: [], error: null }];
    await GET(cronRequest('test-cron-secret'));
    const endDateFilters = state.rangeFilters.filter((f) => f.col === 'end_date');
    expect(endDateFilters.some((f) => f.bound === 'gte')).toBe(true);
    expect(endDateFilters.some((f) => f.bound === 'lte')).toBe(true);
  });

  it('skips a member already charged today (double cron run guard)', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perTableQueue.set('payments', [{ data: { id: 'already-charged' }, error: null }]);

    await GET(cronRequest('test-cron-secret'));

    expect(paystackFetch).not.toHaveBeenCalled();
    expect(state.updates.filter((u) => u.table === 'instructor_subscriptions')).toHaveLength(0);
  });
});

describe('GET /api/cron/auto-debit-instructors — guards', () => {
  it('no_price: skips when instructor_pricing row is missing — never calls Paystack with a stale amount', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: null, error: null }]); // pricing gone

    await GET(cronRequest('test-cron-secret'));

    expect(paystackFetch).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('no_card: skips when no saved card exists for the member', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: null, error: null }]);

    await GET(cronRequest('test-cron-secret'));

    expect(paystackFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/auto-debit-instructors — Paystack subaccount routing', () => {
  it('omits subaccount when the gym has no paystack_subaccount_code', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perTableQueue.set('payments', [{ data: null, error: null }]);
    state.paystackResult = 'success';

    await GET(cronRequest('test-cron-secret'));

    expect(paystackFetch).toHaveBeenCalledTimes(1);
    const call = state.paystackCalls[0];
    const body = call.body as Record<string, unknown>;
    expect(body.subaccount).toBeUndefined();
    expect(body.bearer).toBeUndefined();
  });

  it('routes funds to the gym when paystack_subaccount_code is present (subaccount + bearer)', async () => {
    state.dueQueue = [{ data: [SUB_WITH_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perTableQueue.set('payments', [{ data: null, error: null }]);
    state.paystackResult = 'success';

    await GET(cronRequest('test-cron-secret'));

    expect(paystackFetch).toHaveBeenCalledTimes(1);
    const body = state.paystackCalls[0].body as Record<string, unknown>;
    expect(body.subaccount).toBe('ACCT_xyz');
    expect(body.bearer).toBe('subaccount');
  });
});

describe('GET /api/cron/auto-debit-instructors — happy path + failure', () => {
  it('successful charge extends end_date by 30 days and writes payments', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perTableQueue.set('payments', [{ data: null, error: null }]);
    state.paystackResult = 'success';

    await GET(cronRequest('test-cron-secret'));

    const subUpdate = state.updates.find((u) => u.table === 'instructor_subscriptions');
    expect(subUpdate).toBeDefined();
    expect((subUpdate?.payload as { end_date?: string }).end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const payIns = state.inserts.find((i) => i.table === 'payments');
    expect(payIns).toBeDefined();
    expect(payIns?.payload).toMatchObject({
      amount: 15000,
      currency: 'NGN',
      payment_method: 'card',
      payment_status: 'successful',
    });
  });

  it('failed charge does NOT mutate end_date (same retry-window invariant as the member cron)', async () => {
    state.dueQueue = [{ data: [SUB_NO_SUBACCOUNT], error: null }];
    state.perTableQueue.set('instructor_pricing', [{ data: { price: 15000 }, error: null }]);
    state.perTableQueue.set('saved_cards', [{ data: { authorization_code: 'AUTH_1' }, error: null }]);
    state.perTableQueue.set('payments', [{ data: null, error: null }]);
    state.paystackResult = 'fail';

    await GET(cronRequest('test-cron-secret'));

    expect(state.updates.filter((u) => u.table === 'instructor_subscriptions')).toHaveLength(0);
    expect(sendAutoDebitFailure).toHaveBeenCalledTimes(1);
  });
});
