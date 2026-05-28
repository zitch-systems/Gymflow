import { describe, it, expect, vi, beforeEach } from 'vitest';

// Onboard-gym's heavy path (auth user creation, gym insert, profile/staff
// upserts, default plans seed, platform_payments insert, saved card upsert,
// welcome email) would be a hefty mock. Instead, target ONLY the early-exit
// guards — purpose check, amount-floor, currency — which catch the bugs we
// previously shipped to production (pay ₦1 → annual subscription). Each
// guard returns 4xx before reaching any mutating code, so we don't need to
// stub the rest of the route to assert them.

const { state } = vi.hoisted(() => {
  const state: { txn: unknown; txnError: Error | null } = { txn: null, txnError: null };
  return { state };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'mock' } }) }) }),
    }),
    auth: { admin: { createUser: async () => ({ data: null, error: { message: 'mock' } }) } },
  }),
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: vi.fn(async () => {
    if (state.txnError) throw state.txnError;
    return state.txn;
  }),
}));
vi.mock('@/lib/email', () => ({ sendTempPassword: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/whatsapp', () => ({ waTempPassword: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/platform/onboard-gym/route';

// The rate limiter is in-memory and shared across the whole vitest run — each
// test must use a fresh IP or the 6th test in this file (limit=5/min) gets
// 429'd instead of exercising the guard we're trying to assert.
let testIp = 0;
function jsonRequest(body: unknown): Request {
  testIp += 1;
  return new Request('https://test.local/api/platform/onboard-gym', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${testIp}` },
    body: JSON.stringify(body),
  });
}

const VALID_METADATA = {
  purpose: 'gym_onboarding',
  slug: 'demo',
  gym_name: 'Demo Gym',
  owner_name: 'Demo Owner',
  owner_phone: '+2348000000000',
  billing: 'monthly',
};

const PRICE_KOBO = 13_999 * 100; // monthly plan amount

beforeEach(() => {
  state.txn = null;
  state.txnError = null;
});

describe('POST /api/platform/onboard-gym — input + payment guards', () => {
  it('400 when reference is missing', async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it('502 when Paystack itself errors', async () => {
    state.txnError = new Error('Paystack 503');
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(502);
  });

  it('400 when Paystack reports the transaction was not successful', async () => {
    state.txn = { status: 'abandoned', metadata: VALID_METADATA, customer: { email: 'a@b.c' }, amount: PRICE_KOBO, currency: 'NGN' };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
  });

  it("400 when metadata.purpose isn't 'gym_onboarding' (cannot reuse a member payment to provision a gym)", async () => {
    state.txn = {
      status: 'success',
      metadata: { ...VALID_METADATA, purpose: 'member_renewal' },
      customer: { email: 'a@b.c' },
      amount: PRICE_KOBO,
      currency: 'NGN',
    };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/purpose/i);
  });

  it('400 when slug is invalid (not in SLUG_RE)', async () => {
    state.txn = {
      status: 'success',
      metadata: { ...VALID_METADATA, slug: 'NOT-VALID-Slug!' },
      customer: { email: 'owner@example.com' },
      amount: PRICE_KOBO,
      currency: 'NGN',
    };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
  });

  it('400 when currency is not NGN', async () => {
    state.txn = {
      status: 'success',
      metadata: VALID_METADATA,
      customer: { email: 'owner@example.com' },
      amount: PRICE_KOBO,
      currency: 'USD',
    };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/currency/i);
  });

  it('400 when the amount is below the plan price (the "pay ₦1, get an annual gym" regression)', async () => {
    state.txn = {
      status: 'success',
      metadata: { ...VALID_METADATA, billing: 'annual' }, // attacker claims annual...
      customer: { email: 'owner@example.com' },
      amount: 100, // ...but only paid ₦1
      currency: 'NGN',
    };
    const res = await POST(jsonRequest({ reference: 'r' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/less than/i);
  });
});
