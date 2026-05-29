import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// /api/paystack/verify is the browser's primary money-handling endpoint:
// the customer hits it after Paystack inline checkout returns a reference.
// It layers four authz gates before reaching fulfilMembershipPurchase:
//   1. per-IP rate limit (anti card-testing / cost amplification)
//   2. signed-in session required
//   3. body validation (reference + plan_id present)
//   4. txn.customer.email must match user.email (case-insensitive)
// All four are tested below — a regression in any one is a real money
// or account-takeover risk. The downstream fulfilment is exercised in
// paystack-fulfill.test.ts; here we only assert the route guards and
// that fulfilment is called with the right arguments.

type VerifyTxn = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  customer: { email: string };
  authorization?: { authorization_code?: string };
};
// Type fulfil's signature so .mock.calls[0] keeps positional argument types
// rather than collapsing to an empty tuple (vitest's default for vi.fn()).
type FulfilArgs = [unknown, string, string, Record<string, unknown>, Record<string, unknown>?];

const { state, fulfilMock, verifyMock } = vi.hoisted(() => {
  const state: {
    sessionUser: { id: string; email: string } | null;
    rateAllow: boolean;
  } = { sessionUser: null, rateAllow: true };
  const fulfilMock = vi.fn(async (...args: FulfilArgs) => { void args; return { ok: true, already: false } as { ok: boolean; already?: boolean; status?: number; error?: string }; });
  const verifyMock = vi.fn(async (): Promise<VerifyTxn> => ({
    status: 'success',
    reference: 'GF-test-ref',
    amount: 500000,
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x' },
  }));
  return { state, fulfilMock, verifyMock };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.sessionUser } }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: verifyMock }));
vi.mock('@/lib/paystack-fulfill', () => ({ fulfilMembershipPurchase: fulfilMock }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ ok: state.rateAllow, retryAfterSec: 30 }),
  rateLimitResponse: () => new Response('Too many requests', { status: 429 }),
  clientIpFromRequest: () => '1.2.3.4',
  // Use the real body-reader so we exercise its 400 path on malformed JSON.
  readJsonBody: async <T,>(req: Request): Promise<T | Response> => {
    try {
      return (await req.json()) as T;
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
  },
}));

import { POST } from '@/app/api/paystack/verify/route';

function req(body: unknown): Request {
  return new Request('https://test.local/api/paystack/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.sessionUser = { id: 'user-1', email: 'member@example.com' };
  state.rateAllow = true;
  fulfilMock.mockClear();
  verifyMock.mockClear();
  fulfilMock.mockResolvedValue({ ok: true, already: false });
  verifyMock.mockResolvedValue({
    status: 'success',
    reference: 'GF-test-ref',
    amount: 500000,
    currency: 'NGN',
    customer: { email: 'member@example.com' },
    authorization: { authorization_code: 'AUTH_x' },
  });
});

describe('/api/paystack/verify — rate limit gate', () => {
  it('returns 429 BEFORE touching Paystack when rate-limited', async () => {
    state.rateAllow = false;
    const res = await POST(req({ reference: 'r', plan_id: 'p' }));
    expect(res.status).toBe(429);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});

describe('/api/paystack/verify — body validation', () => {
  it('400 when reference missing', async () => {
    const res = await POST(req({ plan_id: 'plan-1' }));
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('400 when plan_id missing', async () => {
    const res = await POST(req({ reference: 'GF-x' }));
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe('/api/paystack/verify — auth gate', () => {
  it('401 when no signed-in user — no Paystack call, no fulfilment', async () => {
    state.sessionUser = null;
    const res = await POST(req({ reference: 'GF-x', plan_id: 'plan-1' }));
    expect(res.status).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});

describe('/api/paystack/verify — Paystack verification', () => {
  it('502 when Paystack /verify throws (network / API down)', async () => {
    verifyMock.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
    const res = await POST(req({ reference: 'GF-x', plan_id: 'plan-1' }));
    expect(res.status).toBe(502);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it('400 when Paystack reports the txn as not successful (e.g. abandoned / failed)', async () => {
    verifyMock.mockResolvedValueOnce({
      status: 'abandoned',
      reference: 'GF-x',
      amount: 500000,
      currency: 'NGN',
      customer: { email: 'member@example.com' },
    });
    const res = await POST(req({ reference: 'GF-x', plan_id: 'plan-1' }));
    expect(res.status).toBe(400);
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});

describe('/api/paystack/verify — reference-stuffing prevention (email match)', () => {
  it('403 when the verified Paystack email belongs to a DIFFERENT signed-in user', async () => {
    // Attacker has a session as user A but submits user B's payment
    // reference (e.g. cribbed from a leaked URL). Must NOT fulfil.
    state.sessionUser = { id: 'user-A', email: 'attacker@example.com' };
    verifyMock.mockResolvedValueOnce({
      status: 'success',
      reference: 'GF-victim',
      amount: 500000,
      currency: 'NGN',
      customer: { email: 'victim@example.com' },
    });
    const res = await POST(req({ reference: 'GF-victim', plan_id: 'plan-1' }));
    expect(res.status).toBe(403);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it('email match is case-insensitive (Supabase / Paystack normalise differently)', async () => {
    state.sessionUser = { id: 'user-1', email: 'Member@Example.com' };
    verifyMock.mockResolvedValueOnce({
      status: 'success',
      reference: 'GF-x',
      amount: 500000,
      currency: 'NGN',
      customer: { email: 'MEMBER@EXAMPLE.COM' },
    });
    const res = await POST(req({ reference: 'GF-x', plan_id: 'plan-1' }));
    expect(res.status).toBe(200);
    expect(fulfilMock).toHaveBeenCalledTimes(1);
  });

  it('403 when Paystack returns NO customer email at all (defence in depth)', async () => {
    verifyMock.mockResolvedValueOnce({
      status: 'success',
      reference: 'GF-x',
      amount: 500000,
      currency: 'NGN',
      customer: { email: '' },
    });
    const res = await POST(req({ reference: 'GF-x', plan_id: 'plan-1' }));
    expect(res.status).toBe(403);
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});

describe('/api/paystack/verify — fulfilment hand-off', () => {
  it('on the happy path, calls fulfilMembershipPurchase with user id + plan + txn', async () => {
    const res = await POST(req({ reference: 'GF-ok', plan_id: 'plan-99', payment_method: 'card' }));
    expect(res.status).toBe(200);
    expect(fulfilMock).toHaveBeenCalledTimes(1);
    const args = fulfilMock.mock.calls[0]!;
    expect(args[1]).toBe('user-1');         // memberId
    expect(args[2]).toBe('plan-99');         // planId
    expect(args[3]).toMatchObject({
      reference: 'GF-ok',                    // the body's reference (same one Paystack just verified)
      amountKobo: 500000,                    // from Paystack's response, not the body
      currency: 'NGN',
      customerEmail: 'member@example.com',
    });
    expect(args[4]).toMatchObject({ paymentMethod: 'card', notify: true });
  });

  it('passes through fulfilment errors with the right status code', async () => {
    fulfilMock.mockResolvedValueOnce({ ok: false, status: 400, error: 'Amount paid is less than the plan price' });
    const res = await POST(req({ reference: 'GF-ok', plan_id: 'plan-1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/less than the plan price/);
  });

  it('reports idempotent re-verification with already=true (status 200)', async () => {
    fulfilMock.mockResolvedValueOnce({ ok: true, already: true });
    const res = await POST(req({ reference: 'GF-dupe', plan_id: 'plan-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
  });
});
