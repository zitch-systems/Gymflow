import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import { planAmountKobo } from '@/lib/platform-plans';

// Switching platform plan (quarterly → annual, Starter → Growth) checks out a
// SECOND Paystack subscription: the plan cards deliberately keep every other
// tier/cycle clickable (components/admin/plan-cards.tsx), and nothing in that
// flow cancelled the first mandate. Both then billed forever, both charges
// resolved back to the same gym, and gyms.paystack_subscription_code — the only
// column naming a mandate, and the only handle the cancel button has — was
// overwritten with the new code, putting the old one permanently out of reach.
//
// The real double charge only reproduces against a live Paystack account, so
// what is pinned here is the fulfiller's side of it: exactly one disable at the
// moment the replacement is confirmed, nothing touched while a checkout is
// merely started, and a disable we could not complete recorded with the old
// code rather than swallowed.
//
// Same substitution as test/paystack-refund.test.ts: the module keeps its real
// SQL shapes and runs them against the real gymflow_test database as the real
// service_role, while Paystack itself is a spy.

type SubFetch = { ok: true; data: { subscriptionCode: string; emailToken: string; status: string } } | { ok: false; error: string; status?: number };
type Disable = { ok: boolean; error?: string; status?: number };

const paystack = vi.hoisted(() => ({
  fetched: [] as string[],
  disabled: [] as Array<{ code: string; token: string }>,
  inits: [] as Array<Record<string, unknown>>,
  nextFetch: null as SubFetch | null,
  nextDisable: null as Disable | null,
}));

// The gym requireStaff hands the owner-only start/cancel actions. Mutable so
// each case can put it in the state the owner is clicking from.
const staff = vi.hoisted(() => ({
  gym: {} as Record<string, unknown>,
}));

const auditCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const sentryCalls = vi.hoisted(() => [] as Array<{ message: string; extra?: Record<string, unknown> }>);

vi.mock('@/lib/paystack', () => ({
  getSubscription: async (code: string) => {
    paystack.fetched.push(code);
    return paystack.nextFetch ?? { ok: true, data: { subscriptionCode: code, emailToken: `TOK_${code}`, status: 'active' } };
  },
  disableSubscription: async (code: string, token: string) => {
    paystack.disabled.push({ code, token });
    return paystack.nextDisable ?? { ok: true };
  },
  initSubscription: async (params: Record<string, unknown>) => {
    paystack.inits.push(params);
    return { ok: true, authorization_url: 'https://checkout.paystack.com/x', reference: 'ref-init' };
  },
}));

vi.mock('@/lib/auth/dal', () => ({ requireStaff: async () => ({ user: { email: 'owner@example.com' }, gym: staff.gym }) }));
vi.mock('@/lib/request-origin', () => ({ requestOrigin: async () => 'https://gymflow.test' }));

vi.mock('@/lib/audit', () => ({
  logAudit: async (entry: Record<string, unknown>) => { auditCalls.push(entry); },
}));

vi.mock('@/lib/server-error', () => ({
  captureServerEvent: async (message: string, extra?: Record<string, unknown>) => { sentryCalls.push({ message, extra }); },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

// ── PostgREST stand-in ───────────────────────────────────────────────────────
// Only the call shapes lib/platform-fulfill.ts actually uses. Table and column
// names are interpolated because they come from the module's own source, never
// from event data; every matched value is bound.

type Row = Record<string, unknown>;
type Filter = [string, unknown];

async function exec(sql: string, params: unknown[]): Promise<{ data: Row[] | null; error: { message: string; code?: string } | null }> {
  try {
    // commit: true — the handler's writes have to survive for the assertions
    // (and for the redelivery case) to see them.
    const rows = await withSession({ role: 'service_role', commit: true }, async (c) => (await c.query(sql, params)).rows as Row[]);
    return { data: rows, error: null };
  } catch (e) {
    // PostgREST reports failures in-band, not by throwing. The SQLSTATE rides
    // along because the module branches on 23505.
    const err = e as Error & { code?: string };
    return { data: null, error: { message: err.message, code: err.code } };
  }
}

function whereClause(filters: Filter[], firstParam: number): string {
  return filters.length ? ` where ${filters.map(([col], i) => `${col} = $${firstParam + i}`).join(' and ')}` : '';
}

function query(build: (filters: Filter[]) => { sql: string; params: unknown[] }) {
  const filters: Filter[] = [];
  const chain = {
    eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
    limit(n: number) { const { sql, params } = build(filters); return exec(`${sql} limit ${n}`, params); },
    async maybeSingle() {
      const { sql, params } = build(filters);
      const res = await exec(`${sql} limit 1`, params);
      return { data: res.data?.[0] ?? null, error: res.error };
    },
    // Thenable so `await admin.from(t).update(v).eq(...)` works like the real
    // builder, which executes on await.
    then<R>(onFulfilled: (v: { data: Row[] | null; error: { message: string; code?: string } | null }) => R) {
      const { sql, params } = build(filters);
      return exec(sql, params).then(onFulfilled);
    },
  };
  return chain;
}

function fakeAdmin() {
  return {
    from: (table: string) => ({
      select: (columns: string) => query((f) => ({
        sql: `select ${columns} from public.${table}${whereClause(f, 1)}`,
        params: f.map(([, v]) => v),
      })),
      insert: (values: Row) => {
        const keys = Object.keys(values);
        return exec(
          `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
          keys.map((k) => values[k]),
        );
      },
      update: (values: Row) => {
        const keys = Object.keys(values);
        return query((f) => ({
          sql: `update public.${table} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}${whereClause(f, keys.length + 1)}`,
          params: [...keys.map((k) => values[k]), ...f.map(([, v]) => v)],
        }));
      },
      delete: () => query((f) => ({ sql: `delete from public.${table}${whereClause(f, 1)}`, params: f.map(([, v]) => v) })),
    }),
  };
}

const { handlePlatformEvent } = await import('@/lib/platform-fulfill');
const { startPlatformSubscription } = await import('@/lib/actions/platform-billing');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OLD_CODE = 'SUB_old_quarterly';
const NEW_CODE = 'SUB_new_annual';
const CUSTOMER = 'CUS_gym_a';
const CODES = { starterQuarterly: 'PLN_sq', growthAnnual: 'PLN_ga' };

const ENV_KEYS = [
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PLAN_STARTER', 'PAYSTACK_PLAN_GROWTH',
  'PAYSTACK_PLAN_STARTER_QUARTERLY', 'PAYSTACK_PLAN_STARTER_ANNUAL',
  'PAYSTACK_PLAN_GROWTH_QUARTERLY', 'PAYSTACK_PLAN_GROWTH_ANNUAL', 'PAYSTACK_PLAN_SCALE',
];
let savedEnv: Record<string, string | undefined>;

/** The gym mid-switch: paying quarterly Starter on OLD_CODE. */
async function gymOnOldPlan(code: string | null = OLD_CODE) {
  await asSuperuser((c) => c.query(
    `update public.gyms
        set paystack_subscription_code = $2, paystack_customer_code = $3,
            subscription_plan = 'starter', subscription_billing_cycle = 'quarterly',
            subscription_status = 'active'
      where id = $1`,
    [IDS.gymA, code, CUSTOMER],
  ));
}

async function gymRow() {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(
      `select paystack_subscription_code, paystack_customer_code, subscription_plan,
              subscription_billing_cycle, subscription_status
         from public.gyms where id = $1`,
      [IDS.gymA],
    );
    return rows[0];
  });
}

const chargeOn = (subscriptionCode: string, planCode: string, tier: 'starter' | 'growth', cycle: 'quarterly' | 'annually', reference: string) => ({
  event: 'charge.success',
  data: {
    reference,
    amount: planAmountKobo(tier, cycle),
    paid_at: '2026-08-20T10:00:00.000Z',
    customer: { customer_code: CUSTOMER },
    plan: { plan_code: planCode },
    subscription_code: subscriptionCode,
    metadata: { kind: 'platform_subscription', gym_id: IDS.gymA, plan: tier, cycle },
  },
});

const switchCharge = (reference = 'ref-switch-1') => chargeOn(NEW_CODE, CODES.growthAnnual, 'growth', 'annually', reference);

describe('platform plan switch — the superseded Paystack mandate', () => {
  beforeAll(async () => { await seed(); });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.PAYSTACK_PLAN_STARTER_QUARTERLY = CODES.starterQuarterly;
    process.env.PAYSTACK_PLAN_GROWTH_ANNUAL = CODES.growthAnnual;
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    paystack.fetched.length = 0;
    paystack.disabled.length = 0;
    paystack.inits.length = 0;
    paystack.nextFetch = null;
    paystack.nextDisable = null;
    auditCalls.length = 0;
    sentryCalls.length = 0;
    await asSuperuser(async (c) => {
      await c.query(`delete from public.platform_payments where gym_id = $1`, [IDS.gymA]);
      await c.query(
        `update public.gyms set paystack_subscription_code = null, paystack_customer_code = null,
            subscription_plan = null, subscription_billing_cycle = null, subscription_status = null
          where id = $1`,
        [IDS.gymA],
      );
    });
  });

  it('disables the old mandate exactly once when the new subscription is confirmed', async () => {
    await gymOnOldPlan();

    expect(await handlePlatformEvent(switchCharge())).toEqual({ ok: true, handled: true });

    // Disabled — and the OLD code, not the one that just charged.
    expect(paystack.disabled).toEqual([{ code: OLD_CODE, token: `TOK_${OLD_CODE}` }]);
    // The email_token comes from the fetch, so it must have been read off the
    // old subscription too.
    expect(paystack.fetched).toEqual([OLD_CODE]);

    const gym = await gymRow();
    expect(gym.paystack_subscription_code).toBe(NEW_CODE);
    expect(gym.subscription_plan).toBe('growth');
    expect(gym.subscription_billing_cycle).toBe('annually');
    expect(gym.subscription_status).toBe('active');
    expect(auditCalls).toHaveLength(0);
  });

  it('does not disable anything on an ordinary renewal of the same subscription', async () => {
    await gymOnOldPlan();
    // A recurring charge on the mandate the gym is already on. Disabling here
    // would cancel the subscription the gym just paid for.
    const renewal = chargeOn(OLD_CODE, CODES.starterQuarterly, 'starter', 'quarterly', 'ref-renewal-1');

    expect(await handlePlatformEvent(renewal)).toEqual({ ok: true, handled: true });

    expect(paystack.disabled).toEqual([]);
    expect(paystack.fetched).toEqual([]);
    expect((await gymRow()).paystack_subscription_code).toBe(OLD_CODE);
  });

  it('does not disable anything on a gym’s first subscription', async () => {
    await gymOnOldPlan(null);

    expect(await handlePlatformEvent(switchCharge())).toEqual({ ok: true, handled: true });

    expect(paystack.disabled).toEqual([]);
    expect((await gymRow()).paystack_subscription_code).toBe(NEW_CODE);
  });

  it('leaves the existing mandate untouched when the new checkout is abandoned', async () => {
    await gymOnOldPlan();
    // The owner clicked Choose, Paystack created the subscription, and the card
    // never settled — subscription.create lands, charge.success never does. The
    // gym must still be billed by (and able to cancel) the mandate it has.
    const created = {
      event: 'subscription.create',
      data: { subscription_code: NEW_CODE, customer: { customer_code: CUSTOMER }, plan: { plan_code: CODES.growthAnnual } },
    };

    expect(await handlePlatformEvent(created)).toEqual({ ok: true, handled: true });

    expect(paystack.disabled).toEqual([]);
    const gym = await gymRow();
    // The live mandate's code is still the one on the row: claiming the column
    // here would orphan it (nothing would ever disable it, and the cancel
    // button reads only this column).
    expect(gym.paystack_subscription_code).toBe(OLD_CODE);
    expect(gym.subscription_plan).toBe('starter');
    expect(gym.subscription_billing_cycle).toBe('quarterly');
  });

  it('still links a gym that has no mandate yet from subscription.create', async () => {
    // The first-subscription case the handler exists for: with nothing stored,
    // the code has to be claimed or recurring events can't resolve back here.
    await gymOnOldPlan(null);
    const created = {
      event: 'subscription.create',
      data: { subscription_code: NEW_CODE, customer: { customer_code: CUSTOMER } },
    };

    expect(await handlePlatformEvent(created)).toEqual({ ok: true, handled: true });
    expect((await gymRow()).paystack_subscription_code).toBe(NEW_CODE);
  });

  it('records the old code for a human when Paystack refuses the disable', async () => {
    await gymOnOldPlan();
    // 5xx / dropped connection: Paystack may well still be billing the old
    // mandate, and the column naming it is about to be overwritten.
    paystack.nextDisable = { ok: false, error: 'Paystack unavailable', status: 502 };

    expect(await handlePlatformEvent(switchCharge())).toEqual({ ok: true, handled: true });

    // Fulfilment is NOT blocked — the gym paid for the new plan.
    const gym = await gymRow();
    expect(gym.paystack_subscription_code).toBe(NEW_CODE);
    expect(gym.subscription_plan).toBe('growth');

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: 'platform_subscription_orphaned', table: 'gyms', gymId: IDS.gymA });
    expect(auditCalls[0].values).toMatchObject({
      old_subscription_code: OLD_CODE, new_subscription_code: NEW_CODE, error: 'Paystack unavailable',
    });
    expect(sentryCalls).toHaveLength(1);
    expect(sentryCalls[0].extra).toMatchObject({ oldSubscriptionCode: OLD_CODE });
  });

  it('records a failed LOOKUP of the old subscription too', async () => {
    await gymOnOldPlan();
    // No email_token means no disable is even possible; a 5xx here is the same
    // unresolved state as a refused disable.
    paystack.nextFetch = { ok: false, error: 'Subscription fetch failed', status: 500 };

    expect(await handlePlatformEvent(switchCharge())).toEqual({ ok: true, handled: true });

    expect(paystack.disabled).toEqual([]);
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0].values as Record<string, unknown>).old_subscription_code).toBe(OLD_CODE);
  });

  it('treats a 4xx as "already gone" rather than an orphan', async () => {
    await gymOnOldPlan();
    // mandateGoneAtPaystack: Paystack has nothing live under the old code —
    // already disabled, or unknown. That IS the end state we wanted.
    paystack.nextDisable = { ok: false, error: 'Subscription not found', status: 404 };

    expect(await handlePlatformEvent(switchCharge())).toEqual({ ok: true, handled: true });

    expect(auditCalls).toHaveLength(0);
    expect(sentryCalls).toHaveLength(0);
    expect((await gymRow()).paystack_subscription_code).toBe(NEW_CODE);
  });

  describe('startPlatformSubscription', () => {
    // The other half of the same defect: every checkout that completes mints a
    // mandate, so the ones that buy nothing must not be started at all.
    beforeEach(() => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_suite';
      process.env.PAYSTACK_PLAN_STARTER_ANNUAL = 'PLN_sa';
      staff.gym = {
        id: IDS.gymA, name: 'Gym A', email: 'gym-a@example.com',
        paystack_subscription_code: OLD_CODE,
        subscription_status: 'active', subscription_plan: 'starter', subscription_billing_cycle: 'quarterly',
      };
    });

    it('refuses a second checkout for the plan the gym is already on', async () => {
      // The card for the current tier+cycle renders disabled, so this is a
      // double-click or a stale tab — and it would leave the gym paying twice
      // for the same plan.
      const res = await startPlatformSubscription('starter', 'quarterly');
      expect(res).toEqual({ ok: false, error: 'You’re already on the quarterly Starter plan.' });
      expect(paystack.inits).toEqual([]);
    });

    it('still lets an owner switch cycle — the UI deliberately allows it', async () => {
      const res = await startPlatformSubscription('starter', 'annually');
      expect(res.ok).toBe(true);
      expect(paystack.inits).toHaveLength(1);
      expect(paystack.inits[0]).toMatchObject({ metadata: { gym_id: IDS.gymA, plan: 'starter', cycle: 'annually' } });
    });

    it('still lets an owner switch tier', async () => {
      const res = await startPlatformSubscription('growth', 'annually');
      expect(res.ok).toBe(true);
      expect(paystack.inits).toHaveLength(1);
    });

    it('lets a cancelled gym re-subscribe to the same plan', async () => {
      // Nothing is billing any more, so the same tier+cycle is a real purchase
      // rather than a duplicate. Refusing it would strand the gym.
      staff.gym.subscription_status = 'cancelled';
      const res = await startPlatformSubscription('starter', 'quarterly');
      expect(res.ok).toBe(true);
      expect(paystack.inits).toHaveLength(1);
    });
  });

  it('does not disable a second time when the same charge is redelivered', async () => {
    await gymOnOldPlan();
    const charge = switchCharge('ref-switch-replay');

    expect(await handlePlatformEvent(charge)).toEqual({ ok: true, handled: true });
    // Paystack retries until it sees a 200; the replay ledger only catches
    // byte-identical bodies, and /billing/callback self-heals the same charge.
    expect(await handlePlatformEvent(charge)).toEqual({ ok: true, handled: true });

    expect(paystack.disabled).toHaveLength(1);
    const count = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.platform_payments where paystack_reference = $1`, ['ref-switch-replay']);
      return rows[0].n;
    });
    expect(count).toBe(1);
  });
});
