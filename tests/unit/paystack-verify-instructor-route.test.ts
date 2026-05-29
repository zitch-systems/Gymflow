import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// /api/paystack/verify-instructor settles instructor-subscription payments.
// Unlike the membership /verify route it does its money writes inline rather
// than through a shared fulfil helper, so the route owns more invariants:
// server-side price lookup (never trust the client amount), currency + amount
// checks, idempotency on payment_reference, and the same session + email-match
// gates. None had route-level coverage. The order of guards matters — pricing
// is looked up BEFORE Paystack is called, so a bad gym/instructor pair must
// 404 without spending a Paystack API call.

type VerifyTxn = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  customer: { email: string };
  authorization?: { authorization_code?: string; reusable?: boolean };
};

const { state, verifyMock } = vi.hoisted(() => {
  type Q = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    sessionUser: { id: string; email: string } | null;
    rateAllow: boolean;
    perTable: Map<string, Q>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  } = { sessionUser: null, rateAllow: true, perTable: new Map(), inserts: [] };

  const verifyMock = vi.fn(async (): Promise<VerifyTxn> => ({
    status: 'success',
    reference: 'GF-instr-ref',
    amount: 1_000_000, // kobo → ₦10,000
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x', reusable: false },
  }));

  return { state, verifyMock };
});

function makeAdmin() {
  return {
    from(table: string) {
      const builder = {
        _insertPayload: null as Record<string, unknown> | null,
        select() { return builder; },
        eq() { return builder; },
        insert(payload: Record<string, unknown>) {
          builder._insertPayload = payload;
          state.inserts.push({ table, payload });
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          state.inserts.push({ table: `${table}:upsert`, payload });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          const q = state.perTable.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          return Promise.resolve(next);
        },
        then<T>(resolve: (v: { data: unknown; error: null }) => T): T {
          // Bare awaited insert (payments) with no .select()/.maybeSingle().
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.sessionUser } }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: verifyMock }));
vi.mock('@/lib/email', () => ({ sendReceipt: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/whatsapp', () => ({ waReceipt: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ ok: state.rateAllow, retryAfterSec: 30 }),
  rateLimitResponse: () => new Response('Too many requests', { status: 429 }),
  clientIpFromRequest: () => '1.2.3.4',
  readJsonBody: async <T,>(req: Request): Promise<T | Response> => {
    try { return (await req.json()) as T; } catch { return new Response('Bad JSON', { status: 400 }); }
  },
}));
// after() runs the deferred receipt callback; stub it to a no-op so the
// response path is all we assert.
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: () => {} };
});

import { POST } from '@/app/api/paystack/verify-instructor/route';

function req(body: unknown): Request {
  return new Request('https://test.local/api/paystack/verify-instructor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GOOD = { reference: 'GF-instr-ref', gym_id: 'gym-1', instructor_id: 'coach-1', months: 2 };

beforeEach(() => {
  state.sessionUser = { id: 'user-1', email: 'member@example.com' };
  state.rateAllow = true;
  state.perTable = new Map();
  state.inserts = [];
  verifyMock.mockClear();
  verifyMock.mockResolvedValue({
    status: 'success',
    reference: 'GF-instr-ref',
    amount: 1_000_000,
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x', reusable: false },
  });
});

// Stage a price of ₦5,000/month and (by default) no prior subscription, then
// a successful insert. months:2 → expected ₦10,000 = 1,000,000 kobo.
function stageHappyPath() {
  state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
  state.perTable.set('instructor_subscriptions', [
    { data: null, error: null },                          // idempotency lookup: none
    { data: { id: 'sub-1' }, error: null },               // insert().select().maybeSingle()
  ]);
}

describe('verify-instructor — gates before Paystack', () => {
  it('429 when rate-limited, no Paystack call', async () => {
    state.rateAllow = false;
    const res = await POST(req(GOOD));
    expect(res.status).toBe(429);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('400 on missing fields', async () => {
    const res = await POST(req({ reference: 'r', gym_id: 'g' }));
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('400 when months out of range (0 or >24)', async () => {
    expect((await POST(req({ ...GOOD, months: 0 }))).status).toBe(400);
    expect((await POST(req({ ...GOOD, months: 25 }))).status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('401 when no session', async () => {
    state.sessionUser = null;
    const res = await POST(req(GOOD));
    expect(res.status).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('404 when instructor pricing is missing — short-circuits before Paystack', async () => {
    state.perTable.set('instructor_pricing', [{ data: null, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(404);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe('verify-instructor — Paystack + money checks', () => {
  it('502 when Paystack /verify throws', async () => {
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    verifyMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const res = await POST(req(GOOD));
    expect(res.status).toBe(502);
  });

  it('400 when txn not successful', async () => {
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    verifyMock.mockResolvedValueOnce({
      status: 'abandoned', reference: 'r', amount: 1_000_000, currency: 'NGN',
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
  });

  it('403 when the Paystack email belongs to a different user (reference stuffing)', async () => {
    state.sessionUser = { id: 'user-A', email: 'attacker@example.com' };
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'GF-victim', amount: 1_000_000, currency: 'NGN',
      customer: { email: 'victim@example.com' },
    });
    const res = await POST(req({ ...GOOD, reference: 'GF-victim' }));
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 when currency is not NGN', async () => {
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'r', amount: 1_000_000, currency: 'USD',
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 when amount paid is less than price × months (underpayment)', async () => {
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'r', amount: 500_000, currency: 'NGN', // ₦5,000 for a ₦10,000 order
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('verify-instructor — idempotency + happy path', () => {
  it('returns already=true and does NOT insert when the reference was seen before', async () => {
    state.perTable.set('instructor_pricing', [{ data: { price: 5000 }, error: null }]);
    state.perTable.set('instructor_subscriptions', [{ data: { id: 'sub-existing' }, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(state.inserts).toHaveLength(0);
  });

  it('inserts the subscription with the SERVER-computed amount (price × months), not the client amount', async () => {
    stageHappyPath();
    const res = await POST(req({ ...GOOD, months: 2 }));
    expect(res.status).toBe(200);
    const subInsert = state.inserts.find((i) => i.table === 'instructor_subscriptions');
    expect(subInsert).toBeDefined();
    // 5000 × 2 — derived server-side from instructor_pricing, immune to a
    // tampered client payload.
    expect(subInsert!.payload.amount_paid).toBe(10000);
    expect(subInsert!.payload.member_id).toBe('user-1');
    expect(subInsert!.payload.payment_reference).toBe('GF-instr-ref');
    // Also mirrors into payments for the gym wallet.
    expect(state.inserts.some((i) => i.table === 'payments')).toBe(true);
  });

  it('does NOT save a card when the authorization is not reusable', async () => {
    stageHappyPath();
    await POST(req(GOOD));
    expect(state.inserts.some((i) => i.table === 'saved_cards:upsert')).toBe(false);
  });

  it('saves the card when the authorization IS reusable', async () => {
    stageHappyPath();
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'GF-instr-ref', amount: 1_000_000, currency: 'NGN',
      customer: { email: 'member@example.com' },
      authorization: { authorization_code: 'AUTH_reuse', reusable: true },
    });
    await POST(req(GOOD));
    expect(state.inserts.some((i) => i.table === 'saved_cards:upsert')).toBe(true);
  });
});
