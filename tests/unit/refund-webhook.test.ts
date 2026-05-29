import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Capture supabase calls to assert webhook routes the event correctly.
const { state, adminMock } = vi.hoisted(() => {
  type Call = { table: string; verb: 'update'; payload: Record<string, unknown>; refEq: string };
  const state: { calls: Call[] } = { calls: [] };
  const adminMock = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(_col: string, val: string) {
              state.calls.push({ table, verb: 'update', payload, refEq: val });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { state, adminMock };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/paystack', () => ({ paystackSecretKey: () => 'test_secret' }));
vi.mock('@/lib/paystack-fulfill', () => ({ fulfilMembershipPurchase: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/paystack/webhook/route';

function sign(raw: string): string {
  return crypto.createHmac('sha512', 'test_secret').update(raw).digest('hex');
}

function buildRequest(body: unknown, opts: { badSig?: boolean } = {}): Request {
  const raw = JSON.stringify(body);
  const sig = opts.badSig ? 'deadbeef' : sign(raw);
  return new Request('https://test.local/api/paystack/webhook', {
    method: 'POST',
    headers: { 'x-paystack-signature': sig, 'content-type': 'application/json' },
    body: raw,
  });
}

beforeEach(() => { state.calls = []; });

describe('Paystack webhook', () => {
  it('rejects requests with a bad signature', async () => {
    const res = await POST(buildRequest({ event: 'charge.success', data: { reference: 'x' } }, { badSig: true }));
    expect(res.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it('rejects requests with a missing signature header', async () => {
    const raw = JSON.stringify({ event: 'charge.success' });
    const req = new Request('https://test.local/api/paystack/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('marks the matching payment refunded on refund.processed', async () => {
    const res = await POST(buildRequest({
      event: 'refund.processed',
      data: { transaction: { reference: 'GF-abc' } },
    }));
    expect(res.status).toBe(200);
    expect(state.calls).toContainEqual({
      table: 'payments',
      verb: 'update',
      payload: { payment_status: 'refunded' },
      refEq: 'GF-abc',
    });
  });

  it('marks the matching payment failed on charge.failed', async () => {
    const res = await POST(buildRequest({
      event: 'charge.failed',
      data: { reference: 'GF-fail-1' },
    }));
    expect(res.status).toBe(200);
    expect(state.calls).toContainEqual({
      table: 'payments',
      verb: 'update',
      payload: { payment_status: 'failed' },
      refEq: 'GF-fail-1',
    });
  });

  it('non-membership charge.success (no plan_id in metadata) falls through to status-only update', async () => {
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFI-instructor-ref',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'm@example.com' },
        metadata: { instructor_id: 'inst-1' },
      },
    }));
    expect(res.status).toBe(200);
    // Should have done a status update, not a membership fulfilment.
    expect(state.calls).toContainEqual({
      table: 'payments',
      verb: 'update',
      payload: { payment_status: 'successful' },
      refEq: 'GFI-instructor-ref',
    });
  });
});

describe('Paystack webhook — transfer events (instructor payouts)', () => {
  it('transfer.success → flips the matching instructor_payouts row to status=paid', async () => {
    const res = await POST(buildRequest({
      event: 'transfer.success',
      data: { transfer_code: 'TRF_abc123' },
    }));
    expect(res.status).toBe(200);
    const call = state.calls.find((c) => c.table === 'instructor_payouts');
    expect(call).toBeDefined();
    expect(call?.payload.status).toBe('paid');
    expect(call?.payload.processed_at).toBeDefined();
    expect(call?.refEq).toBe('TRF_abc123');
  });

  it('transfer.failed → flips the matching row to status=rejected', async () => {
    const res = await POST(buildRequest({
      event: 'transfer.failed',
      data: { transfer_code: 'TRF_def456' },
    }));
    expect(res.status).toBe(200);
    const call = state.calls.find((c) => c.table === 'instructor_payouts');
    expect(call?.payload.status).toBe('rejected');
    expect(call?.refEq).toBe('TRF_def456');
  });

  it('transfer.reversed (settlement bounced back) → also marks rejected', async () => {
    const res = await POST(buildRequest({
      event: 'transfer.reversed',
      data: { transfer_code: 'TRF_ghi789' },
    }));
    expect(res.status).toBe(200);
    const call = state.calls.find((c) => c.table === 'instructor_payouts');
    expect(call?.payload.status).toBe('rejected');
  });

  it('transfer event without a transfer_code is a no-op (200, no DB writes)', async () => {
    const res = await POST(buildRequest({
      event: 'transfer.success',
      data: {},
    }));
    expect(res.status).toBe(200);
    expect(state.calls.filter((c) => c.table === 'instructor_payouts')).toHaveLength(0);
  });

  it('transfer event always returns BEFORE the charge.success membership fulfilment path', async () => {
    // Critical for routing: an attacker forging a transfer.success with a fake
    // transfer_code must NOT also trigger membership creation. The transfer
    // handler returns inline so the rest of the route never sees the event.
    const res = await POST(buildRequest({
      event: 'transfer.success',
      data: {
        transfer_code: 'TRF_x',
        // These would normally trigger membership fulfilment if the event
        // type fell through — they must NOT be touched.
        reference: 'GF-attacker',
        customer: { email: 'attacker@example.com' },
        metadata: { plan_id: 'plan-1' },
      },
    }));
    expect(res.status).toBe(200);
    // No payments row touched.
    expect(state.calls.filter((c) => c.table === 'payments')).toHaveLength(0);
  });
});
