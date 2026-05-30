import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// /api/paystack/verify-pt-pack settles a member's PT-pack purchase. Same
// shape as /verify-instructor: server-side pack price lookup, full email +
// currency + amount guard ladder, then a pt_pack_credits + payments insert
// under the service-role client. The invariants worth locking:
//   - the four pre-Paystack gates (429 / 400 / 401 / 404 missing pack)
//     short-circuit BEFORE a Paystack API call
//   - cross-gym IDOR: a member buying a pack from a gym they DON'T belong
//     to gets a 403 with no inserts (the pack's gym_id is the source of
//     truth, not the request body)
//   - 403 on email mismatch (reference-stuffing), 400 on non-NGN / under-
//     payment, with NO inserts in any failure case
//   - idempotency: prior pt_pack_credits row with the same reference
//     returns {already:true} with no new insert
//   - happy path inserts pt_pack_credits with sessions_total = pack count,
//     sessions_used = 0, source='paystack' AND mirrors a payments row at
//     the SERVER-derived price (immune to a tampered client payload)
//   - inactive pack returns 400 with no insert

type VerifyTxn = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  customer: { email: string };
  authorization?: { authorization_code?: string };
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
    reference: 'GFP-test-ref',
    amount: 5_000_000, // kobo → ₦50,000
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x' },
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
        maybeSingle() {
          // For inserts that .select('id').maybeSingle() afterwards
          if (builder._insertPayload && table === 'pt_pack_credits') {
            return Promise.resolve({ data: { id: 'credit-new' }, error: null });
          }
          const q = state.perTable.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          return Promise.resolve(next);
        },
        then<T>(resolve: (v: { data: unknown; error: null }) => T): T {
          // Bare-awaited insert (payments) returns null/null.
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
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: () => {} };
});

import { POST } from '@/app/api/paystack/verify-pt-pack/route';

function req(body: unknown): Request {
  return new Request('https://test.local/api/paystack/verify-pt-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GOOD = { reference: 'GFP-test-ref', pack_id: 'pack-1' };

beforeEach(() => {
  state.sessionUser = { id: 'user-1', email: 'member@example.com' };
  state.rateAllow = true;
  state.perTable = new Map();
  state.inserts = [];
  verifyMock.mockClear();
  verifyMock.mockResolvedValue({
    status: 'success',
    reference: 'GFP-test-ref',
    amount: 5_000_000,
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x' },
  });
});

// Default fixture: pack exists, active, member is in the gym, no prior credit.
function stageHappyPath() {
  state.perTable.set('pt_packs', [
    { data: { id: 'pack-1', gym_id: 'gym-1', instructor_id: 'coach-1', name: '10x Ada', session_count: 10, price: 50000, is_active: true }, error: null },
  ]);
  state.perTable.set('gym_member_links', [{ data: { user_id: 'user-1' }, error: null }]);
  state.perTable.set('pt_pack_credits', [{ data: null, error: null }]); // no prior credit
}

describe('verify-pt-pack — gates before Paystack', () => {
  it('429 when rate-limited, no Paystack call', async () => {
    state.rateAllow = false;
    const res = await POST(req(GOOD));
    expect(res.status).toBe(429);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('400 on missing reference or pack_id', async () => {
    expect((await POST(req({ pack_id: 'p' }))).status).toBe(400);
    expect((await POST(req({ reference: 'r' }))).status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('401 when no session', async () => {
    state.sessionUser = null;
    const res = await POST(req(GOOD));
    expect(res.status).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('404 when the pack is missing — no Paystack call', async () => {
    state.perTable.set('pt_packs', [{ data: null, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(404);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('400 when the pack is deactivated — no insert', async () => {
    state.perTable.set('pt_packs', [
      { data: { id: 'pack-1', gym_id: 'gym-1', instructor_id: 'coach-1', name: '10x', session_count: 10, price: 50000, is_active: false }, error: null },
    ]);
    state.perTable.set('gym_member_links', [{ data: { user_id: 'user-1' }, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("403 cross-gym IDOR: member isn't part of the pack's gym — no Paystack call, no inserts", async () => {
    state.perTable.set('pt_packs', [
      { data: { id: 'pack-1', gym_id: 'gym-2', instructor_id: 'coach-1', name: '10x', session_count: 10, price: 50000, is_active: true }, error: null },
    ]);
    state.perTable.set('gym_member_links', [{ data: null, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(403);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });
});

describe('verify-pt-pack — Paystack + money guards', () => {
  it('502 when Paystack /verify throws', async () => {
    stageHappyPath();
    verifyMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const res = await POST(req(GOOD));
    expect(res.status).toBe(502);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 when txn not successful', async () => {
    stageHappyPath();
    verifyMock.mockResolvedValueOnce({
      status: 'abandoned', reference: 'r', amount: 5_000_000, currency: 'NGN',
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it('403 reference-stuffing: Paystack email differs from session — no insert', async () => {
    state.sessionUser = { id: 'user-A', email: 'attacker@example.com' };
    stageHappyPath();
    state.perTable.set('gym_member_links', [{ data: { user_id: 'user-A' }, error: null }]);
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'GFP-victim', amount: 5_000_000, currency: 'NGN',
      customer: { email: 'victim@example.com' },
    });
    const res = await POST(req({ ...GOOD, reference: 'GFP-victim' }));
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 on non-NGN currency', async () => {
    stageHappyPath();
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'r', amount: 5_000_000, currency: 'USD',
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 on underpayment (amount < pack.price) — no insert', async () => {
    stageHappyPath();
    verifyMock.mockResolvedValueOnce({
      status: 'success', reference: 'r', amount: 1_000_000, currency: 'NGN', // ₦10k for a ₦50k pack
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('verify-pt-pack — idempotency + happy path', () => {
  it('returns already=true and does NOT insert when the reference was seen before', async () => {
    state.perTable.set('pt_packs', [
      { data: { id: 'pack-1', gym_id: 'gym-1', instructor_id: 'coach-1', name: '10x', session_count: 10, price: 50000, is_active: true }, error: null },
    ]);
    state.perTable.set('gym_member_links', [{ data: { user_id: 'user-1' }, error: null }]);
    state.perTable.set('pt_pack_credits', [{ data: { id: 'credit-existing' }, error: null }]);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(state.inserts).toHaveLength(0);
  });

  it('inserts the credit with sessions_total = pack count + source=paystack, AND mirrors a payments row at the SERVER price (not the client)', async () => {
    stageHappyPath();
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBe(10);

    const credit = state.inserts.find((i) => i.table === 'pt_pack_credits')!;
    expect(credit).toBeDefined();
    expect(credit.payload).toMatchObject({
      gym_id: 'gym-1',
      member_id: 'user-1',
      instructor_id: 'coach-1',
      pack_id: 'pack-1',
      sessions_total: 10,
      sessions_used: 0,
      source: 'paystack',
      paystack_reference: 'GFP-test-ref',
    });

    const payment = state.inserts.find((i) => i.table === 'payments')!;
    expect(payment).toBeDefined();
    // ₦50,000 came from the SERVER's pt_packs.price lookup, not from
    // anything in the request body — a tampered metadata can't reduce it.
    expect(payment.payload).toMatchObject({
      gym_id: 'gym-1',
      member_id: 'user-1',
      amount: 50000,
      currency: 'NGN',
      payment_method: 'card',
      payment_status: 'successful',
      paystack_reference: 'GFP-test-ref',
    });
  });
});
