import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: mocks.verify }));
import { ownershipEvidence, paymentIncidentSnapshot } from '@/lib/payment-incident-diagnostics';

const gym = '11111111-2222-4333-8444-555555555555';
type Query = { table: string; column?: string; value?: unknown; limit?: number };
let queries: Query[];
let read: (query: Query) => { data: unknown[] | null; error: unknown };
const verified = () => ({ ok: true, status: 'success', reference: 'private-reference', amountKobo: 10_000,
  currency: 'NGN', metadata: { gym_id: gym, kind: 'platform_subscription', plan: 'growth' },
  memberEventData: { customer: { customer_code: 'private-customer' }, subscription_code: 'private-subscription' },
});

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  read = query => ({ data: query.table === 'operational_incidents' ? [{ reference: 'private-reference' }] : [], error: null });
  mocks.from.mockImplementation((table: string) => {
    const query: Query = { table };
    queries.push(query);
    const chain = {
      select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: unknown) => { Object.assign(query, { column, value }); return chain; }),
      limit: vi.fn((limit: number) => { query.limit = limit; return Promise.resolve(read(query)); }),
    };
    return chain;
  });
  mocks.verify.mockResolvedValue(verified());
});

describe('read-only payment incident evidence', () => {
  it('never assigns an owner from missing, conflicting or ambiguous evidence', () => {
    expect(ownershipEvidence([], [], [])).toEqual({ state: 'missing', id: null });
    expect(ownershipEvidence(['a'], ['b'], [])).toEqual({ state: 'conflicting', id: null });
    expect(ownershipEvidence(['a'], [], ['b'])).toEqual({ state: 'conflicting', id: null });
    expect(ownershipEvidence(['a', 'b'], ['a'], ['a'])).toEqual({ state: 'ambiguous', id: null });
    expect(ownershipEvidence(['a'], ['a'], ['a'])).toEqual({ state: 'subscription', id: 'a' });
    expect(ownershipEvidence([], ['a'], ['a'])).toEqual({ state: 'customer', id: 'a' });
    expect(ownershipEvidence([], [], ['a'])).toEqual({ state: 'metadata', id: 'a' });
  });

  it('compares provider and local evidence without returning raw identifiers or amounts', async () => {
    read = query => ({ data: query.table === 'operational_incidents' ? [{ reference: 'private-reference' }]
      : query.table === 'gyms' ? [{ id: gym }]
        : query.table === 'platform_payments' ? [{ gym_id: gym, amount: 100, currency: 'NGN', payment_status: 'successful' }] : [], error: null });
    const result = await paymentIncidentSnapshot();
    expect(result).toMatchObject({ read_only: true, truncated: false, checked: 1, results: [{
      provider: 'success', ownership: 'subscription', local_amount_matches: true, local_currency_matches: true,
      local_gym_matches: true, local_platform_payments: 1, recognized_platform_plan: true,
    }] });
    const serialized = JSON.stringify(result);
    for (const secret of ['private-reference', 'private-customer', 'private-subscription', gym, '10000']) expect(serialized).not.toContain(secret);
    expect(result.results[0].reference_digest).toMatch(/^[a-f0-9]{16}$/);
    expect(queries.filter(q => q.table !== 'operational_incidents').every(q => q.limit === 2)).toBe(true);
  });

  it('rejects a mismatched provider reference before inspecting local payment data', async () => {
    mocks.verify.mockResolvedValue({ ...verified(), reference: 'wrong-reference' });
    expect((await paymentIncidentSnapshot()).results[0]).toMatchObject({ provider: 'reference_mismatch' });
    expect(queries.map(q => q.table)).toEqual(['operational_incidents']);
  });

  it('reports disagreements without resolving, refunding or requeueing anything', async () => {
    read = query => ({ data: query.table === 'operational_incidents' ? [{ reference: 'private-reference' }]
      : query.table === 'gyms' ? [{ id: gym }]
        : query.table === 'payments' ? [{ gym_id: 'other-gym', amount: 999, currency: 'USD' }] : [], error: null });
    expect((await paymentIncidentSnapshot()).results[0]).toMatchObject({ local_amount_matches: false, local_currency_matches: false, local_gym_matches: false });
    expect(queries.every(q => ['operational_incidents', 'gyms', 'payments', 'platform_payments'].includes(q.table))).toBe(true);
  });

  it('bounds work, deduplicates references and runs at most two provider requests together', async () => {
    read = query => ({ data: query.table === 'operational_incidents'
      ? [{ reference: 'ref-0' }, ...Array.from({ length: 20 }, (_, i) => ({ reference: `ref-${i}` }))] : [], error: null });
    let active = 0, peak = 0;
    mocks.verify.mockImplementation(async (reference: string) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return { ...verified(), reference };
    });
    const result = await paymentIncidentSnapshot();
    expect(result).toMatchObject({ truncated: true, checked: 8 });
    expect(result.results[0].incident_count).toBe(2);
    expect(mocks.verify).toHaveBeenCalledTimes(8);
    expect(peak).toBe(2);
    expect(queries[0].limit).toBe(21);
  });

  it('returns fixed labels instead of provider or database exception text', async () => {
    mocks.verify.mockResolvedValueOnce({ ok: false, error: 'private-provider-body' });
    expect((await paymentIncidentSnapshot()).results[0]).toMatchObject({ provider: 'lookup_failed' });
    mocks.verify.mockRejectedValueOnce(new Error('private-provider-body'));
    expect((await paymentIncidentSnapshot()).results[0]).toMatchObject({ provider: 'diagnostic_unavailable' });
    read = query => ({ data: query.table === 'operational_incidents' ? [{ reference: 'private-reference' }] : null,
      error: query.table === 'gyms' ? 'private-database-body' : null });
    expect((await paymentIncidentSnapshot()).results[0]).toMatchObject({ provider: 'diagnostic_unavailable' });
  });

  it('fails closed on incident query errors and does not contact Paystack for invalid references', async () => {
    read = () => ({ data: null, error: 'private-database-body' });
    await expect(paymentIncidentSnapshot()).rejects.toThrow('Payment incident inspection unavailable');
    read = () => ({ data: [{ reference: null }, { reference: '' }, { reference: 'x'.repeat(201) }], error: null });
    expect(await paymentIncidentSnapshot()).toMatchObject({ checked: 0, results: [] });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
