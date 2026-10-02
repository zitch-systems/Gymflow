import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const ALT_PLAN = 'c1111111-1111-1111-1111-111111111112';
const CHECKOUT_URL = 'https://checkout.paystack.com/member-auto-test';

type Reservation = {
  created: boolean;
  reference: string;
  state: 'initializing' | 'ready' | 'fulfilled' | 'cancelled';
  url: string | null;
};

const reserveArgs = (reference: string, planId: string = IDS.planA): unknown[] => [
  reference, IDS.gymA, IDS.memberA, planId, 1_000_000, 0, 1, false, 'PLN_member_a',
];

async function reserve(reference: string, planId: string = IDS.planA): Promise<Reservation> {
  return withSession({ role: 'service_role', commit: true }, async (client) => {
    const { rows } = await client.query<{ result: Reservation }>(
      `select public.reserve_member_auto_renewal($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
      reserveArgs(reference, planId),
    );
    return rows[0].result;
  });
}

async function finish(
  reference: string,
  input: { url?: string; definiteFailure?: boolean; error?: string } = {},
): Promise<boolean> {
  return withSession({ role: 'service_role', commit: true }, async (client) => {
    const { rows } = await client.query<{ result: boolean }>(
      `select public.finish_member_auto_renewal_initialization($1,$2,$3,$4) as result`,
      [reference, input.url ?? null, input.definiteFailure === true, input.error ?? null],
    );
    return rows[0].result;
  });
}

async function intent() {
  return asSuperuser(async (client) => {
    const { rows } = await client.query(
      `select gym_id,member_id,reference,plan_id,trainer_addon,state,authorization_url,
              initialization_error,created_at,updated_at
         from public.member_auto_renewal_intents
        where gym_id=$1 and member_id=$2`,
      [IDS.gymA, IDS.memberA],
    );
    return rows[0] as Record<string, unknown> | undefined;
  });
}

describe('durable member auto-renewal intents', () => {
  beforeAll(async () => { await seed(); });

  beforeEach(async () => {
    await asSuperuser(async (client) => {
      await client.query(`delete from public.member_auto_renewal_intents where gym_id=$1 and member_id=$2`, [IDS.gymA, IDS.memberA]);
      await client.query(`delete from public.member_payment_checkouts where gym_id=$1 and member_id=$2`, [IDS.gymA, IDS.memberA]);
      await client.query(
        `insert into public.membership_plans(id,gym_id,name,duration_months,price,is_active)
         values($1,$2,'Alternate monthly A',1,12000,true)
         on conflict(id) do update set gym_id=excluded.gym_id,is_active=true`,
        [ALT_PLAN, IDS.gymA],
      );
      await client.query(
        `update public.member_subscriptions set auto_debit_enabled=false
          where gym_id=$1 and member_id=$2`,
        [IDS.gymA, IDS.memberA],
      );
    });
  });

  it('serializes concurrent opt-ins to one intent and one server-owned checkout snapshot', async () => {
    const [a, b] = await Promise.all([
      reserve('auto-concurrent-a'),
      reserve('auto-concurrent-b'),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.reference).toBe(b.reference);
    expect(a.state).toBe('initializing');
    expect(b.state).toBe('initializing');

    const snapshot = await asSuperuser(async (client) => {
      const { rows } = await client.query(
        `select reference,gym_id,member_id,plan_id,amount_kobo,duration_days,
                duration_months,trainer_addon,provider_plan_code
           from public.member_payment_checkouts
          where gym_id=$1 and member_id=$2`,
        [IDS.gymA, IDS.memberA],
      );
      return rows;
    });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      reference: a.reference,
      gym_id: IDS.gymA,
      member_id: IDS.memberA,
      plan_id: IDS.planA,
      amount_kobo: '1000000',
      duration_days: 0,
      duration_months: 1,
      trainer_addon: false,
      provider_plan_code: 'PLN_member_a',
    });
  });

  it('reuses the same pending or ready checkout regardless of elapsed time', async () => {
    const first = await reserve('auto-durable-original');
    await asSuperuser((client) => client.query(
      `update public.member_auto_renewal_intents
          set created_at=now()-interval '30 days',updated_at=now()-interval '30 days'
        where reference=$1`,
      [first.reference],
    ));

    const pendingRetry = await reserve('auto-durable-later');
    expect(pendingRetry).toEqual({
      created: false,
      reference: first.reference,
      state: 'initializing',
      url: null,
    });

    expect(await finish(first.reference, { url: CHECKOUT_URL })).toBe(true);
    const readyRetry = await reserve('auto-ready-later');
    expect(readyRetry).toEqual({
      created: false,
      reference: first.reference,
      state: 'ready',
      url: CHECKOUT_URL,
    });
  });

  it('blocks a different plan while any non-cancelled intent is reserved', async () => {
    await reserve('auto-plan-a');
    await asSuperuser((client) => client.query(
      `update public.member_auto_renewal_intents set updated_at=now()-interval '1 year'
        where gym_id=$1 and member_id=$2`,
      [IDS.gymA, IDS.memberA],
    ));

    await expect(reserve('auto-plan-b', ALT_PLAN)).rejects.toMatchObject({ code: '22023' });
    expect((await intent())?.plan_id).toBe(IDS.planA);
  });

  it('is callable only by service_role, including for password-authenticated members', async () => {
    for (const context of [
      { role: 'anon' as const },
      { role: 'authenticated' as const, uid: IDS.memberA, verified: false },
    ]) {
      await expect(withSession(context, async (client) => client.query(
        `select public.reserve_member_auto_renewal($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        reserveArgs(`forbidden-${context.role}`),
      ))).rejects.toMatchObject({ code: '42501' });
      await expect(withSession(context, async (client) => client.query(
        `select public.finish_member_auto_renewal_initialization($1,$2,$3,$4)`,
        ['forbidden', CHECKOUT_URL, false, null],
      ))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('blocks reservation when the provider-backed auto-debit flag is active', async () => {
    await asSuperuser((client) => client.query(
      `update public.member_subscriptions set auto_debit_enabled=true
        where gym_id=$1 and member_id=$2`,
      [IDS.gymA, IDS.memberA],
    ));
    await expect(reserve('auto-live-provider')).rejects.toMatchObject({ code: '22023' });
    expect(await intent()).toBeUndefined();
  });

  it('marks the intent fulfilled from checkout fulfillment and blocks replacement until confirmed cancellation', async () => {
    const first = await reserve('auto-fulfilled');
    await asSuperuser((client) => client.query(
      `update public.member_payment_checkouts set fulfilled_at=now() where reference=$1`,
      [first.reference],
    ));
    expect((await intent())?.state).toBe('fulfilled');

    const retry = await reserve('auto-after-fulfilled');
    expect(retry).toMatchObject({ created: false, reference: first.reference, state: 'fulfilled' });
    await expect(reserve('auto-after-fulfilled-other-plan', ALT_PLAN)).rejects.toMatchObject({ code: '22023' });

    await asSuperuser((client) => client.query(
      `update public.member_auto_renewal_intents set state='cancelled',updated_at=now()
        where gym_id=$1 and member_id=$2 and state='fulfilled'`,
      [IDS.gymA, IDS.memberA],
    ));
    const afterCancellation = await reserve('auto-after-confirmed-cancel');
    expect(afterCancellation).toMatchObject({ created: true, reference: 'auto-after-confirmed-cancel', state: 'initializing' });
  });

  it('accepts only Paystack HTTPS checkout URLs', async () => {
    const invalidUrls = [
      'http://checkout.paystack.com/token',
      'https://checkout.paystack.example/token',
      'https://checkout.paystack.com/token?next=evil',
      'https://checkout.paystack.com/',
    ];
    for (const [index, invalid] of invalidUrls.entries()) {
      const reservation = await reserve(`invalid-url-${index}`);
      await expect(finish(reservation.reference, { url: invalid })).rejects.toMatchObject({ code: '22023' });
      await asSuperuser((client) => client.query(
        `update public.member_auto_renewal_intents set state='cancelled' where reference=$1`,
        [reservation.reference],
      ));
    }

    const valid = await reserve('valid-checkout-url');
    expect(await finish(valid.reference, { url: CHECKOUT_URL })).toBe(true);
    expect(await intent()).toMatchObject({ state: 'ready', authorization_url: CHECKOUT_URL });
  });

  it('keeps ambiguous initialization failures reserved but permits retry after definitive rejection', async () => {
    const ambiguous = await reserve('auto-ambiguous');
    expect(await finish(ambiguous.reference, { error: 'network timeout' })).toBe(true);
    expect(await intent()).toMatchObject({ state: 'initializing', initialization_error: 'network timeout' });
    expect(await reserve('auto-ambiguous-retry')).toMatchObject({
      created: false,
      reference: ambiguous.reference,
      state: 'initializing',
    });

    expect(await finish(ambiguous.reference, {
      definiteFailure: true,
      error: 'provider rejected initialization',
    })).toBe(true);
    expect((await intent())?.state).toBe('cancelled');
    expect(await reserve('auto-definitive-retry')).toMatchObject({
      created: true,
      reference: 'auto-definitive-retry',
      state: 'initializing',
    });
  });
});

// Action-level regression guard. The database tests above prove the lock and
// state machine; this proves startAutoRenewal respects the created/ready result
// and never exposes a provider URL before finish_member_auto_renewal_initialization
// confirms that it was saved.
const action = vi.hoisted(() => ({
  intent: null as null | { reference: string; state: 'initializing' | 'ready'; url: string | null },
  reserveCalls: 0,
  initCalls: [] as Array<Record<string, unknown>>,
  finishCalls: [] as Array<Record<string, unknown>>,
  finishSucceeds: true,
  cancelSub: null as null | Record<string, unknown>,
  subscriptionUpdateError: null as null | { message: string },
  subscriptionUpdateCalls: [] as Array<Record<string, unknown>>,
  intentCancelCalls: 0,
  disableCalls: [] as Array<{ code: string; token: string }>,
  disableResult: { ok: true } as { ok: boolean; error?: string; status?: number },
  initPromise: Promise.resolve({
    ok: true,
    authorization_url: 'https://checkout.paystack.com/member-auto-test',
  }),
}));

vi.mock('@/lib/auth/dal', () => ({
  ADMIN_ROLES: ['gym_owner'],
  requireMember: async () => ({
    user: { id: 'b1111111-1111-1111-1111-111111111111', email: 'memberA@example.com' },
    gym: { id: '11111111-1111-1111-1111-111111111111', name: 'Gym A' },
  }),
  requireStaff: async () => { throw new Error('not used'); },
}));
vi.mock('@/lib/gym-status', () => ({ isOfflineGym: () => false }));
vi.mock('@/lib/entitlements', () => ({ gymCanUse: () => true, memberLockedMessage: () => 'locked' }));
vi.mock('@/lib/request-origin', () => ({ requestOrigin: async () => 'https://gymflow.test' }));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: async () => undefined }));
vi.mock('@/lib/paystack', () => ({
  planIntervalFor: () => 'monthly',
  createPlan: async () => ({ ok: false, error: 'must use cached plan code' }),
  initSubscription: async (params: Record<string, unknown>) => {
    action.initCalls.push(params);
    return action.initPromise;
  },
  getSubscription: async () => ({ ok: false, error: 'not used' }),
  disableSubscription: async (code: string, token: string) => {
    action.disableCalls.push({ code, token });
    return action.disableResult;
  },
}));
vi.mock('@/lib/member-checkout', () => ({
  reserveAutoRenewalCheckout: async () => {
    action.reserveCalls += 1;
    if (action.intent) return { ok: true, created: false, ...action.intent };
    action.intent = { reference: 'action-auto-ref', state: 'initializing', url: null };
    return { ok: true, created: true, ...action.intent };
  },
  finishAutoRenewalInitialization: async (_admin: unknown, input: Record<string, unknown>) => {
    action.finishCalls.push(input);
    if (action.finishSucceeds && typeof input.url === 'string') {
      action.intent = { reference: String(input.reference), state: 'ready', url: input.url };
    }
    return action.finishSucceeds;
  },
}));

function fakeActionAdmin() {
  return {
    from(table: string) {
      if (table === 'member_subscriptions') {
        return {
          select: (columns: string) => {
            const chain = {
              eq: () => chain,
              in: async () => ({ data: [{ auto_debit_enabled: false }], error: null }),
              maybeSingle: async () => ({ data: action.cancelSub, error: null }),
            };
            if (columns === 'auto_debit_enabled') return chain;
            return chain;
          },
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              action.subscriptionUpdateCalls.push(values);
              return { data: null, error: action.subscriptionUpdateError };
            },
          }),
        };
      }
      if (table === 'membership_plans') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: IDS.planA, gym_id: IDS.gymA, name: 'Monthly A', price: 10000,
                      duration_days: null, duration_months: 1, paystack_plan_code: 'PLN_member_a',
                      paystack_plan_code_trainer: null, trainer_addon_enabled: false,
                      trainer_addon_price: 0,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'member_auto_renewal_intents') {
        const updateChain = {
          eq: () => updateChain,
          then: <T>(resolve: (value: { data: null; error: null }) => T) => {
            action.intentCancelCalls += 1;
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return { update: () => updateChain };
      }
      throw new Error(`unexpected action table ${table}`);
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeActionAdmin() }));

const { cancelAutoRenewSelf, startAutoRenewal } = await import('@/lib/actions/member-billing');
const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY;

describe('startAutoRenewal reservation ordering', () => {
  beforeEach(() => {
    action.intent = null;
    action.reserveCalls = 0;
    action.initCalls = [];
    action.finishCalls = [];
    action.finishSucceeds = true;
    action.cancelSub = null;
    action.subscriptionUpdateError = null;
    action.subscriptionUpdateCalls = [];
    action.intentCancelCalls = 0;
    action.disableCalls = [];
    action.disableResult = { ok: true };
    action.initPromise = Promise.resolve({ ok: true, authorization_url: CHECKOUT_URL });
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_member_auto';
  });

  afterAll(() => {
    if (originalPaystackSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret;
  });

  it('initializes once for two overlapping attempts and reuses the saved ready URL', async () => {
    let release!: (value: { ok: true; authorization_url: string }) => void;
    action.initPromise = new Promise((resolve) => { release = resolve; });

    const first = startAutoRenewal(IDS.planA);
    await vi.waitFor(() => expect(action.initCalls).toHaveLength(1));
    const second = await startAutoRenewal(IDS.planA);
    expect(second).toMatchObject({ ok: false });
    expect(action.initCalls).toHaveLength(1);

    release({ ok: true, authorization_url: CHECKOUT_URL });
    await expect(first).resolves.toEqual({ ok: true, url: CHECKOUT_URL });
    expect(action.finishCalls).toHaveLength(1);

    await expect(startAutoRenewal(IDS.planA)).resolves.toEqual({ ok: true, url: CHECKOUT_URL });
    expect(action.initCalls).toHaveLength(1);
  });

  it('does not expose an authorization URL when persisting ready state fails', async () => {
    action.finishSucceeds = false;
    const result = await startAutoRenewal(IDS.planA);
    expect(action.initCalls).toHaveLength(1);
    expect(action.finishCalls).toHaveLength(1);
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty('url');
  });

  it('does not clear an automatic local flag when the provider mandate code is missing', async () => {
    action.cancelSub = {
      id: 'd1111111-1111-1111-1111-111111111111',
      gym_id: IDS.gymA,
      member_id: IDS.memberA,
      end_date: '2026-12-31',
      plan_id: IDS.planA,
      paystack_subscription_code: null,
      paystack_email_token: null,
      auto_debit_enabled: true,
    };
    const form = new FormData();
    form.set('subId', String(action.cancelSub.id));

    const result = await cancelAutoRenewSelf({ ok: false, error: null }, form);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/provider mandate could not be identified/i);
    expect(action.disableCalls).toHaveLength(0);
    expect(action.subscriptionUpdateCalls).toHaveLength(0);
    expect(action.intentCancelCalls).toBe(0);
  });

  it('reports a failed local save after provider cancellation and leaves the intent guarded', async () => {
    action.cancelSub = {
      id: 'd1111111-1111-1111-1111-111111111111',
      gym_id: IDS.gymA,
      member_id: IDS.memberA,
      end_date: '2026-12-31',
      plan_id: IDS.planA,
      paystack_subscription_code: 'SUB_member_a',
      paystack_email_token: 'TOKEN_member_a',
      auto_debit_enabled: true,
    };
    action.subscriptionUpdateError = { message: 'write failed' };
    const form = new FormData();
    form.set('subId', String(action.cancelSub.id));

    const result = await cancelAutoRenewSelf({ ok: false, error: null }, form);
    expect(action.disableCalls).toEqual([{ code: 'SUB_member_a', token: 'TOKEN_member_a' }]);
    expect(action.subscriptionUpdateCalls).toEqual([{ auto_debit_enabled: false }]);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/saved setting could not be confirmed/i);
    expect(action.intentCancelCalls).toBe(0);
  });
});
