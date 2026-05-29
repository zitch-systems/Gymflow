import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';
import { PLATFORM_PRICING } from '@/lib/platform-pricing';

// The two "initiate" routes start a Paystack checkout. They never write to
// our DB and never settle money — verify/webhook do that — but they're the
// first gate against signup spam and Paystack cost amplification, and they
// pin the AMOUNT that the customer is asked to pay. A bug that lets the
// client dictate the platform price, or that skips the per-IP cap, is a real
// cost/abuse problem. Both were untested.

const { state, initMock } = vi.hoisted(() => {
  const state: {
    sessionUser: { id: string; email: string } | null;
    rateAllow: boolean;
  } = { sessionUser: null, rateAllow: true };
  const initMock = vi.fn(async (_args: { email: string; amount: number; metadata?: Record<string, unknown>; callbackUrl?: string }) => {
    void _args;
    return { authorization_url: 'https://paystack/x', access_code: 'AC', reference: 'GF-new' };
  });
  return { state, initMock };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.sessionUser } }) },
  }),
}));
vi.mock('@/lib/paystack', () => ({ initializeTransaction: initMock }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ ok: state.rateAllow, retryAfterSec: 30 }),
  rateLimitResponse: () => new Response('Too many requests', { status: 429 }),
  clientIpFromRequest: () => '1.2.3.4',
  readJsonBody: async <T,>(req: Request): Promise<T | Response> => {
    try { return (await req.json()) as T; } catch { return new Response('Bad JSON', { status: 400 }); }
  },
}));

import { POST as platformInitiate } from '@/app/api/platform/initiate/route';
import { POST as memberInitiate } from '@/app/api/paystack/initiate/route';

function req(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const pReq = (b: unknown) => req('https://test.local/api/platform/initiate', b);
const mReq = (b: unknown) => req('https://test.local/api/paystack/initiate', b);

beforeEach(() => {
  state.sessionUser = { id: 'user-1', email: 'member@example.com' };
  state.rateAllow = true;
  initMock.mockClear();
  initMock.mockResolvedValue({ authorization_url: 'https://paystack/x', access_code: 'AC', reference: 'GF-new' });
});

const GOOD_GYM = { gymName: 'Iron Temple', ownerEmail: 'owner@example.com', ownerName: 'Ada', slug: 'iron-temple', billing: 'monthly' };

describe('/api/platform/initiate — unauthenticated signup gate', () => {
  it('429 when rate-limited, no Paystack call', async () => {
    state.rateAllow = false;
    const res = await platformInitiate(pReq(GOOD_GYM));
    expect(res.status).toBe(429);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('400 on an invalid slug (uppercase / bad chars)', async () => {
    expect((await platformInitiate(pReq({ ...GOOD_GYM, slug: 'Iron Temple' }))).status).toBe(400);
    expect((await platformInitiate(pReq({ ...GOOD_GYM, slug: '-bad-' }))).status).toBe(400);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('400 on missing gym name / owner name', async () => {
    expect((await platformInitiate(pReq({ ...GOOD_GYM, gymName: '' }))).status).toBe(400);
    expect((await platformInitiate(pReq({ ...GOOD_GYM, ownerName: '' }))).status).toBe(400);
  });

  it('400 on a malformed owner email', async () => {
    const res = await platformInitiate(pReq({ ...GOOD_GYM, ownerEmail: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('charges the SERVER-side plan price, not anything from the client; locks purpose=gym_onboarding', async () => {
    const res = await platformInitiate(pReq({ ...GOOD_GYM, billing: 'annual', amount: 1 }));
    expect(res.status).toBe(200);
    expect(initMock).toHaveBeenCalledTimes(1);
    const args = initMock.mock.calls[0]![0];
    // Annual price comes from PLATFORM_PRICING, ignoring the client's amount:1.
    expect(args.amount).toBe(PLATFORM_PRICING.annual.amount);
    expect(args.metadata?.purpose).toBe('gym_onboarding');
    expect(args.metadata?.slug).toBe('iron-temple');
    expect(args.metadata?.billing).toBe('annual');
  });

  it('defaults an unknown billing period to monthly', async () => {
    await platformInitiate(pReq({ ...GOOD_GYM, billing: 'lifetime' }));
    const args = initMock.mock.calls[0]![0];
    expect(args.amount).toBe(PLATFORM_PRICING.monthly.amount);
    expect(args.metadata?.billing).toBe('monthly');
  });

  it('502 when Paystack init throws', async () => {
    initMock.mockRejectedValueOnce(new Error('Paystack 503'));
    const res = await platformInitiate(pReq(GOOD_GYM));
    expect(res.status).toBe(502);
  });
});

describe('/api/paystack/initiate — member checkout gate', () => {
  it('429 when rate-limited, no Paystack call', async () => {
    state.rateAllow = false;
    const res = await memberInitiate(mReq({ email: 'member@example.com', amount: 5000 }));
    expect(res.status).toBe(429);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('400 when email or amount missing', async () => {
    expect((await memberInitiate(mReq({ amount: 5000 }))).status).toBe(400);
    expect((await memberInitiate(mReq({ email: 'member@example.com' }))).status).toBe(400);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('401 when no signed-in user', async () => {
    state.sessionUser = null;
    const res = await memberInitiate(mReq({ email: 'member@example.com', amount: 5000 }));
    expect(res.status).toBe(401);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('403 when the requested email differs from the session email', async () => {
    const res = await memberInitiate(mReq({ email: 'someone-else@example.com', amount: 5000 }));
    expect(res.status).toBe(403);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('on success, stamps the metadata with the authenticated member id', async () => {
    const res = await memberInitiate(mReq({ email: 'member@example.com', amount: 5000, metadata: { plan_id: 'p1' } }));
    expect(res.status).toBe(200);
    const args = initMock.mock.calls[0]![0];
    expect(args.metadata?.plan_id).toBe('p1');
    expect(args.metadata?.member_id).toBe('user-1'); // server stamps this, client can't spoof it
  });

  it('502/500 when Paystack init throws', async () => {
    initMock.mockRejectedValueOnce(new Error('Paystack down'));
    const res = await memberInitiate(mReq({ email: 'member@example.com', amount: 5000 }));
    expect(res.status).toBe(500);
  });
});
