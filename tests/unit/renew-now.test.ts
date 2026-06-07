import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-test queues so each test scenario can stage its own (user-scoped /
// admin) DB results. Hoisted so vi.mock factories can see them.
const { state } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    userQueue: Queue;
    adminQueue: Queue;
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: unknown }>;
    upserts: Array<{ table: string; payload: unknown }>;
    sessionUser: { id: string; email: string } | null;
    txn: unknown;
    txnError: Error | null;
  } = {
    userQueue: [],
    adminQueue: [],
    inserts: [],
    updates: [],
    upserts: [],
    sessionUser: null,
    txn: null,
    txnError: null,
  };
  return { state };
});

// Chainable mock builder — every chain method returns `this`; awaiting yields
// the next queued result. Tracks insert/update/upsert payloads for assertions.
function mockBuilder(queue: typeof state.userQueue, kind: 'user' | 'admin') {
  return {
    from(table: string) {
      const self: {
        table: string;
        kind: 'user' | 'admin';
        select: () => typeof self;
        insert: (p: unknown) => typeof self;
        update: (p: unknown) => typeof self;
        upsert: (p: unknown) => typeof self;
        delete: () => typeof self;
        eq: () => typeof self;
        in: () => typeof self;
        ilike: () => typeof self;
        order: () => typeof self;
        limit: () => typeof self;
        maybeSingle: () => typeof self;
        single: () => typeof self;
        gte: () => typeof self;
        lte: () => typeof self;
        then: <T>(resolve: (v: unknown) => T) => T;
      } = {
        table,
        kind,
        select() { return self; },
        insert(p: unknown) { state.inserts.push({ table, payload: p }); return self; },
        update(p: unknown) { state.updates.push({ table, payload: p }); return self; },
        upsert(p: unknown) { state.upserts.push({ table, payload: p }); return self; },
        delete() { return self; },
        eq() { return self; },
        in() { return self; },
        ilike() { return self; },
        order() { return self; },
        limit() { return self; },
        maybeSingle() { return self; },
        single() { return self; },
        gte() { return self; },
        lte() { return self; },
        then<T>(resolve: (v: unknown) => T): T {
          const r = queue.shift() ?? { data: null, error: null };
          return resolve(r);
        },
      };
      return self;
    },
    auth: {
      getUser: async () => ({ data: { user: state.sessionUser } }),
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => mockBuilder(state.userQueue, 'user'),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockBuilder(state.adminQueue, 'admin'),
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: vi.fn(async () => {
    if (state.txnError) throw state.txnError;
    return state.txn;
  }),
  paystackSecretKey: () => 'test',
}));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: () => undefined };
});

import { POST } from '@/app/api/platform/renew-now/route';
import { PLATFORM_PRICING } from '@/lib/platform-pricing';

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://test.local/api/platform/renew-now', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.userQueue = [];
  state.adminQueue = [];
  state.inserts = [];
  state.updates = [];
  state.upserts = [];
  state.sessionUser = null;
  state.txn = null;
  state.txnError = null;
});

const GYM = {
  id: 'gym-1',
  slug: 'demo',
  email: 'owner@example.com',
  subscription_plan: 'monthly',
  trial_ends_at: '2026-06-01T00:00:00Z',
  subscription_status: 'past_due',
};

const VALID_TXN = {
  status: 'success',
  reference: 'GFP-test-1',
  amount: PLATFORM_PRICING.monthly.amount * 100, // gym is on the monthly plan; price in kobo
  currency: 'NGN',
  customer: { email: 'owner@example.com' },
  authorization: {
    authorization_code: 'AUTH_xyz',
    reusable: true,
    last4: '1111',
    card_type: 'visa',
    brand: 'visa',
  },
};

describe('POST /api/platform/renew-now — authorization', () => {
  it('rejects unauthenticated callers with 401', async () => {
    state.sessionUser = null;
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'g' }));
    expect(res.status).toBe(401);
  });

  it('rejects callers who are not the gym owner with 403', async () => {
    state.sessionUser = { id: 'other-user', email: 'attacker@example.com' };
    state.userQueue = [{ data: null, error: null }]; // gym_staff_links lookup returns nothing
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(403);
  });

  it('rejects requests missing reference or gym_id with 400', async () => {
    state.sessionUser = { id: 'owner', email: 'owner@example.com' };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/platform/renew-now — amount + currency assertions', () => {
  function authedAsOwner() {
    state.sessionUser = { id: 'owner', email: 'owner@example.com' };
    state.userQueue = [{ data: { role: 'gym_owner' }, error: null }]; // owner link found
    // admin client: gyms select
    state.adminQueue = [
      { data: GYM, error: null },
      { data: null, error: null }, // idempotency check (no existing platform_payments row)
    ];
  }

  it('rejects non-NGN currency with 400', async () => {
    authedAsOwner();
    state.txn = { ...VALID_TXN, currency: 'USD' };
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/NGN/i);
  });

  it('rejects under-paid amount even with valid currency', async () => {
    authedAsOwner();
    state.txn = { ...VALID_TXN, amount: 100 }; // ₦1
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/less than/i);
  });

  it('rejects when the Paystack email does not match the session user (reference stuffing)', async () => {
    authedAsOwner();
    state.txn = { ...VALID_TXN, customer: { email: 'someone-else@example.com' } };
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(403);
  });

  it('rejects when Paystack reports status != success', async () => {
    authedAsOwner();
    state.txn = { ...VALID_TXN, status: 'abandoned' };
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(400);
  });

  it('returns 502 when Paystack itself errors', async () => {
    authedAsOwner();
    state.txnError = new Error('Paystack 503');
    const res = await POST(jsonRequest({ reference: 'r', gym_id: 'gym-1' }));
    expect(res.status).toBe(502);
  });
});

describe('POST /api/platform/renew-now — happy path', () => {
  it('updates the gym, records platform_payments, and saves the card', async () => {
    state.sessionUser = { id: 'owner-1', email: 'owner@example.com' };
    state.userQueue = [{ data: { role: 'gym_owner' }, error: null }];
    state.adminQueue = [
      { data: GYM, error: null },                // gyms select
      { data: null, error: null },               // platform_payments idempotency miss
      { data: null, error: null },               // gyms update result
    ];
    state.txn = VALID_TXN;

    const res = await POST(jsonRequest({ reference: VALID_TXN.reference, gym_id: GYM.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Gym row updated with active + a new trial_ends_at.
    const gymsUpdate = state.updates.find((u) => u.table === 'gyms');
    expect(gymsUpdate).toBeDefined();
    expect(gymsUpdate?.payload).toMatchObject({ subscription_status: 'active' });

    // platform_payments insert at the plan price.
    const pp = state.inserts.find((i) => i.table === 'platform_payments');
    expect(pp).toBeDefined();
    expect((pp?.payload as { amount: number; paystack_reference: string }).paystack_reference).toBe(VALID_TXN.reference);

    // saved_cards upsert wired to the reusable authorization so the cron can
    // take over next cycle.
    const sc = state.upserts.find((u) => u.table === 'saved_cards');
    expect(sc).toBeDefined();
    expect((sc?.payload as { authorization_code: string }).authorization_code).toBe('AUTH_xyz');
  });

  it('idempotent on reference — short-circuits with already=true', async () => {
    state.sessionUser = { id: 'owner-1', email: 'owner@example.com' };
    state.userQueue = [{ data: { role: 'gym_owner' }, error: null }];
    state.adminQueue = [
      { data: GYM, error: null },                                       // gyms select
      { data: { id: 'existing-payment' }, error: null },                // platform_payments HIT
    ];
    state.txn = VALID_TXN;

    const res = await POST(jsonRequest({ reference: VALID_TXN.reference, gym_id: GYM.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, already: true });
    // No mutating side effects on the idempotent path.
    expect(state.updates.filter((u) => u.table === 'gyms')).toEqual([]);
    expect(state.inserts.filter((i) => i.table === 'platform_payments')).toEqual([]);
  });
});
