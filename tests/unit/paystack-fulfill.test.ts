import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the side-effect modules before importing the SUT.
vi.mock('@/lib/email', () => ({ sendReceipt: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/whatsapp', () => ({ waReceipt: vi.fn(async () => ({ ok: true })) }));

import { fulfilMembershipPurchase } from '@/lib/paystack-fulfill';
import { createMockSupabase } from './_mock-supabase';

const PLAN = {
  id: 'plan-1',
  gym_id: 'gym-1',
  name: 'Monthly',
  price: 20000,
  duration_months: 1,
  is_active: true,
};

const TXN = {
  reference: 'GF-test-1',
  amountKobo: 2_000_000, // = ₦20,000
  currency: 'NGN' as const,
  customerEmail: 'member@example.com',
  authorization: {
    authorization_code: 'AUTH_xyz',
    reusable: true,
    last4: '1111',
    exp_month: '12',
    exp_year: '2030',
    card_type: 'visa',
    bank: 'Test Bank',
    brand: 'visa',
  },
};

beforeEach(() => vi.clearAllMocks());

describe('fulfilMembershipPurchase', () => {
  it('idempotent: returns already=true when reference is already recorded', async () => {
    const supabase = createMockSupabase([
      { data: { id: 'existing-payment' }, error: null }, // payments select by reference
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fulfilMembershipPurchase(supabase as any, 'user-1', 'plan-1', TXN);
    expect(result).toEqual({ ok: true, already: true });
    expect(supabase._consumed()).toBe(1);
  });

  it('rejects when the plan is missing or inactive', async () => {
    const supabase = createMockSupabase([
      { data: null, error: null },                                 // no existing payment
      { data: { ...PLAN, is_active: false }, error: null },        // plan exists but inactive
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fulfilMembershipPurchase(supabase as any, 'user-1', 'plan-1', TXN);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects non-NGN currency', async () => {
    const supabase = createMockSupabase([
      { data: null, error: null },        // no existing payment
      { data: PLAN, error: null },        // plan lookup
    ]);
    const result = await fulfilMembershipPurchase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'plan-1',
      { ...TXN, currency: 'USD' },
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/currency/i) });
  });

  it('rejects when amount paid is less than plan price', async () => {
    const supabase = createMockSupabase([
      { data: null, error: null },
      { data: PLAN, error: null },
    ]);
    const result = await fulfilMembershipPurchase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'user-1',
      'plan-1',
      { ...TXN, amountKobo: 100 }, // tampered to ₦1
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/less than/i) });
  });

  it('happy path: creates membership + payment + saved card', async () => {
    const supabase = createMockSupabase([
      { data: null, error: null },                              // 1. payments idempotency check (no row)
      { data: PLAN, error: null },                              // 2. plan lookup
      { data: null, error: null },                              // 3. current membership for pay-ahead (none)
      { data: { id: 'memb-1' }, error: null },                  // 4. memberships insert .. select
      { data: null, error: null },                              // 5. payments insert
      { data: null, error: null },                              // 6. saved_cards upsert
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fulfilMembershipPurchase(supabase as any, 'user-1', 'plan-1', TXN, { notify: false });
    expect(result).toEqual({ ok: true, membershipId: 'memb-1' });
    expect(supabase._fromCalls.map((c) => c.table)).toEqual([
      'payments', 'membership_plans', 'memberships', 'memberships', 'payments', 'saved_cards',
    ]);
  });

  it('race rollback: rolls back membership when payment insert fails with unique violation', async () => {
    const supabase = createMockSupabase([
      { data: null, error: null },                                          // idempotency check
      { data: PLAN, error: null },                                          // plan
      { data: null, error: null },                                          // current membership lookup
      { data: { id: 'memb-race' }, error: null },                           // membership insert OK
      { data: null, error: { message: 'duplicate key value violates unique constraint' } }, // payment insert fails
      { data: null, error: null },                                          // memberships delete (rollback)
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fulfilMembershipPurchase(supabase as any, 'user-1', 'plan-1', TXN);
    expect(result).toEqual({ ok: true, already: true });
    // Verify rollback issued a memberships.delete after the failed payment insert.
    expect(supabase._fromCalls.map((c) => c.table)).toEqual([
      'payments', 'membership_plans', 'memberships', 'memberships', 'payments', 'memberships',
    ]);
  });
});
