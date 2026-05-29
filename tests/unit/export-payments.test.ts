import { describe, it, expect, vi, beforeEach } from 'vitest';

// Differentiated invariants from the audit / members exports:
//   - date inputs are STRICT YYYY-MM-DD or fall back to defaults
//   - method/status are clamped to the schema's CHECK constraint values
//   - lte cutoff is to+1 day so a 1-day range includes the whole "to" day

const { state, requireStaff, getSessionUser, supabaseMock, audit } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    requireStaffError: Error | null;
    perTableQueue: Map<string, Queue>;
    auditCalls: unknown[];
    capturedEq: Array<{ col: string; val: string }>;
    capturedGte: Array<{ col: string; val: string }>;
    capturedLte: Array<{ col: string; val: string }>;
  } = {
    requireStaffError: null,
    perTableQueue: new Map(),
    auditCalls: [],
    capturedEq: [],
    capturedGte: [],
    capturedLte: [],
  };
  const requireStaff = vi.fn(async (slug: string) => {
    if (state.requireStaffError) throw state.requireStaffError;
    return { gym: { id: 'gym-1', slug, name: 'Demo' }, role: 'manager' };
  });
  const getSessionUser = vi.fn(async () => ({ id: 'staff-1' }));
  const audit = vi.fn(async (args: unknown) => {
    state.auditCalls.push(args);
  });
  const supabaseMock = {
    from(table: string) {
      const builder: {
        select(): typeof builder;
        eq(col: string, val: string): typeof builder;
        gte(col: string, val: string): typeof builder;
        lte(col: string, val: string): typeof builder;
        in(): typeof builder;
        order(): typeof builder;
        limit(): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
      } = {
        select() { return builder; },
        eq(col: string, val: string) {
          state.capturedEq.push({ col, val });
          return builder;
        },
        gte(col: string, val: string) {
          state.capturedGte.push({ col, val });
          return builder;
        },
        lte(col: string, val: string) {
          state.capturedLte.push({ col, val });
          return builder;
        },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        then<T>(resolve: (v: unknown) => T): T {
          const q = state.perTableQueue.get(table);
          return resolve(q?.shift() ?? { data: [], error: null });
        },
      };
      return builder;
    },
  };
  return { state, requireStaff, getSessionUser, supabaseMock, audit };
});

vi.mock('@/lib/auth/gym', () => ({ requireStaff }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabaseMock }));
vi.mock('@/lib/audit', () => ({ audit }));

import { exportPaymentsCsv } from '@/lib/actions/export-payments';

beforeEach(() => {
  state.requireStaffError = null;
  state.perTableQueue.clear();
  state.auditCalls.length = 0;
  state.capturedEq.length = 0;
  state.capturedGte.length = 0;
  state.capturedLte.length = 0;
  requireStaff.mockClear();
  getSessionUser.mockClear();
  audit.mockClear();
});

describe('exportPaymentsCsv — auth', () => {
  it('runs requireStaff (front-desk and up allowed)', async () => {
    await exportPaymentsCsv('demo');
    expect(requireStaff).toHaveBeenCalledWith('demo');
  });

  it('propagates the requireStaff redirect', async () => {
    state.requireStaffError = new Error('redirect');
    await expect(exportPaymentsCsv('demo')).rejects.toThrow('redirect');
  });
});

describe('exportPaymentsCsv — input clamping', () => {
  it('a malformed "from" date falls back to ~30 days ago, not a SQL error', async () => {
    await exportPaymentsCsv('demo', { from: 'not-a-date', to: '2026-05-29' });
    const gte = state.capturedGte.find((g) => g.col === 'payment_date');
    expect(gte).toBeDefined();
    // ago(30) returns YYYY-MM-DD (midnight UTC) so the gap is 30d + 0–24h
    // depending on what time of day this test is running.
    const daysBack = (Date.now() - new Date(gte!.val).getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThanOrEqual(29.9);
    expect(daysBack).toBeLessThanOrEqual(31.1);
  });

  it('rejects an unknown payment_method silently (no .eq fires for method)', async () => {
    await exportPaymentsCsv('demo', { method: 'btc' });
    const methodEq = state.capturedEq.find((e) => e.col === 'payment_method');
    expect(methodEq).toBeUndefined();
  });

  it('accepts a CHECK-constraint-valid payment_method', async () => {
    await exportPaymentsCsv('demo', { method: 'bank_transfer' });
    expect(state.capturedEq).toContainEqual({ col: 'payment_method', val: 'bank_transfer' });
  });

  it('rejects an unknown payment_status silently', async () => {
    await exportPaymentsCsv('demo', { status: 'partially_paid' });
    const statusEq = state.capturedEq.find((e) => e.col === 'payment_status');
    expect(statusEq).toBeUndefined();
  });

  it('accepts a CHECK-constraint-valid payment_status', async () => {
    await exportPaymentsCsv('demo', { status: 'refunded' });
    expect(state.capturedEq).toContainEqual({ col: 'payment_status', val: 'refunded' });
  });

  it('the lte cutoff is "to" + 1 day so the whole "to" day is included', async () => {
    await exportPaymentsCsv('demo', { from: '2026-05-29', to: '2026-05-29' });
    const lte = state.capturedLte.find((l) => l.col === 'payment_date');
    expect(lte).toBeDefined();
    // 2026-05-29 00:00 UTC + 1 day = 2026-05-30 00:00 UTC
    expect(lte!.val).toBe('2026-05-30T00:00:00.000Z');
  });
});

describe('exportPaymentsCsv — CSV shape', () => {
  it('renders one header + one row per payment, RFC 4180-escaped', async () => {
    state.perTableQueue.set('payments', [
      {
        data: [
          {
            id: 'p-1',
            payment_date: '2026-05-29T10:00:00Z',
            payment_method: 'card',
            payment_status: 'successful',
            amount: 25000,
            currency: 'NGN',
            paystack_reference: 'GF-abc-123',
            member_id: 'u-1',
            plan_id: 'plan-1',
            profiles: { full_name: 'Tunde, "T" Adesina', first_name: 'Tunde', email: 't@e.com' },
            membership_plans: { name: 'Monthly' },
          },
        ],
        error: null,
      },
    ]);

    const r = await exportPaymentsCsv('demo', { from: '2026-05-01', to: '2026-05-31' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.csv.split('\n');
    expect(lines[0]).toBe('payment_date,reference,member_name,member_email,plan,method,status,currency,amount');
    expect(lines).toHaveLength(2);
    // Comma + quote in the name → RFC 4180 wrap with doubled quotes.
    expect(lines[1]).toContain('"Tunde, ""T"" Adesina"');
    expect(lines[1]).toContain('GF-abc-123');
    expect(lines[1]).toContain('25000');
  });

  it('handles a payment with no member / no plan join — empty cells, not literal "null"', async () => {
    state.perTableQueue.set('payments', [
      {
        data: [
          {
            id: 'p-2',
            payment_date: '2026-05-29T10:00:00Z',
            payment_method: 'cash',
            payment_status: 'successful',
            amount: 10000,
            currency: 'NGN',
            paystack_reference: null,
            member_id: null,
            plan_id: null,
            profiles: null,
            membership_plans: null,
          },
        ],
        error: null,
      },
    ]);

    const r = await exportPaymentsCsv('demo', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dataLine = r.csv.split('\n')[1];
    // No "null" anywhere in the data row.
    expect(dataLine).not.toContain('null');
    // 9 columns → 8 commas, no value contains "null".
    expect((dataLine.match(/,/g) ?? []).length).toBe(8);
  });
});

describe('exportPaymentsCsv — audit + filename', () => {
  it('writes admin.payments_exported with the active filter set in the after snapshot', async () => {
    await exportPaymentsCsv('demo', { from: '2026-05-01', to: '2026-05-31', method: 'card', status: 'successful' });
    expect(audit).toHaveBeenCalledTimes(1);
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      action: string;
      table: string;
      after: { row_count: number; filename: string; from: string; to: string; method: string | null; status: string | null };
    };
    expect(call.action).toBe('admin.payments_exported');
    expect(call.table).toBe('payments');
    expect(call.after.from).toBe('2026-05-01');
    expect(call.after.to).toBe('2026-05-31');
    expect(call.after.method).toBe('card');
    expect(call.after.status).toBe('successful');
    expect(call.after.filename).toBe('demo-payments-2026-05-01_to_2026-05-31.csv');
  });

  it('clamped (invalid) method/status appear as null in the audit log, not the malformed value', async () => {
    await exportPaymentsCsv('demo', { from: '2026-05-01', to: '2026-05-31', method: 'btc', status: 'maybe' });
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      after: { method: string | null; status: string | null };
    };
    expect(call.after.method).toBeNull();
    expect(call.after.status).toBeNull();
  });
});
