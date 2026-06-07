import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Capture supabase calls to assert webhook routes the event correctly.
// transferLookup is FIFO-popped by the .maybeSingle() chain so each test
// stages whatever priorRow it needs (or null for a no-row case).
const { state, adminMock, emailMocks, waMocks, ptPackFulfilMock, instructorSubFulfilMock } = vi.hoisted(() => {
  type Call = { table: string; verb: 'update'; payload: Record<string, unknown>; refEq: string };
  const state: { calls: Call[]; transferLookup: unknown[]; profileLookup: { id: string } | null } = { calls: [], transferLookup: [], profileLookup: { id: 'member-1' } };
  const adminMock = {
    from(table: string) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        ilike() { return chain; },
        maybeSingle: async () => {
          // profiles email lookup (pt-pack / membership member resolution)
          if (table === 'profiles') return { data: state.profileLookup, error: null };
          return { data: state.transferLookup.shift() ?? null, error: null };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_col: string, val: string) {
              state.calls.push({ table, verb: 'update', payload, refEq: val });
              return { error: null };
            },
          };
        },
      };
      return chain;
    },
  };
  const ptPackFulfilMock = vi.fn(async (_sb: unknown, args: { packId: string; memberId: string; reference: string }) => {
    void _sb; void args; return { ok: true as const };
  });
  const instructorSubFulfilMock = vi.fn(async (_sb: unknown, args: { gymId: string; instructorId: string; memberId: string; months: number; reference: string }) => {
    void _sb; void args; return { ok: true as const };
  });
  type PaidArgs = { name: string; amount: number; bankName: string; accountLast4: string; earningsUrl?: string };
  type FailArgs = { name: string; amount: number; reason: 'failed' | 'reversed'; earningsUrl: string };
  const emailMocks = {
    sendPayoutPaid: vi.fn(async (to: string, args: PaidArgs) => { void to; void args; return { ok: true }; }),
    sendPayoutFailed: vi.fn(async (to: string, args: FailArgs) => { void to; void args; return { ok: true }; }),
  };
  const waMocks = {
    waPayoutPaid: vi.fn(async (phone: string, args: PaidArgs) => { void phone; void args; return { ok: true }; }),
    waPayoutFailed: vi.fn(async (phone: string, args: FailArgs) => { void phone; void args; return { ok: true }; }),
  };
  return { state, adminMock, emailMocks, waMocks, ptPackFulfilMock, instructorSubFulfilMock };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/paystack', () => ({ paystackSecretKey: () => 'test_secret' }));
vi.mock('@/lib/paystack-fulfill', () => ({ fulfilMembershipPurchase: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/pt-pack-fulfill', () => ({ fulfilPtPackPurchase: ptPackFulfilMock }));
vi.mock('@/lib/instructor-sub-fulfill', () => ({ fulfilInstructorSubscription: instructorSubFulfilMock }));
vi.mock('@/lib/email', () => emailMocks);
vi.mock('@/lib/whatsapp', () => waMocks);

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

beforeEach(() => {
  state.calls = [];
  state.transferLookup = [];
  state.profileLookup = { id: 'member-1' };
  emailMocks.sendPayoutPaid.mockClear();
  emailMocks.sendPayoutFailed.mockClear();
  waMocks.waPayoutPaid.mockClear();
  waMocks.waPayoutFailed.mockClear();
  ptPackFulfilMock.mockClear();
  instructorSubFulfilMock.mockClear();
});

describe('Paystack webhook — PT-pack purchase backstop', () => {
  it('fulfils a pt_pack charge.success (closed-tab backstop) via fulfilPtPackPurchase', async () => {
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFP-backstop-1',
        amount: 5000000,
        currency: 'NGN',
        customer: { email: 'member@example.com' },
        metadata: { purpose: 'pt_pack', pack_id: 'pack-1' },
      },
    }));
    expect(res.status).toBe(200);
    expect(ptPackFulfilMock).toHaveBeenCalledTimes(1);
    const args = ptPackFulfilMock.mock.calls[0]![1];
    expect(args.packId).toBe('pack-1');
    expect(args.memberId).toBe('member-1'); // resolved from the Paystack email
    expect(args.reference).toBe('GFP-backstop-1');
  });

  it('does NOT call membership fulfilment for a pt_pack charge (returns early)', async () => {
    // A pt_pack charge has no plan_id; the early return must keep it off the
    // membership path entirely.
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFP-x',
        customer: { email: 'member@example.com' },
        metadata: { purpose: 'pt_pack', pack_id: 'pack-1' },
      },
    }));
    expect(res.status).toBe(200);
    expect(ptPackFulfilMock).toHaveBeenCalledTimes(1);
    // No payments status-only update happened (that's the non-membership fall-through).
    expect(state.calls.filter((c) => c.table === 'payments')).toHaveLength(0);
  });

  it('logs and 200s when the member email cannot be resolved (no crash)', async () => {
    state.profileLookup = null; // email not found
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFP-noemail',
        customer: { email: 'ghost@example.com' },
        metadata: { purpose: 'pt_pack', pack_id: 'pack-1' },
      },
    }));
    expect(res.status).toBe(200);
    expect(ptPackFulfilMock).not.toHaveBeenCalled();
  });
});

describe('Paystack webhook — instructor-subscription backstop', () => {
  it('fulfils an instructor-sub charge.success (closed-tab backstop)', async () => {
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFI-backstop-1',
        amount: 1000000,
        currency: 'NGN',
        customer: { email: 'member@example.com' },
        metadata: { gym_id: 'gym-1', instructor_id: 'coach-1', months: 2 },
      },
    }));
    expect(res.status).toBe(200);
    expect(instructorSubFulfilMock).toHaveBeenCalledTimes(1);
    const args = instructorSubFulfilMock.mock.calls[0]![1];
    expect(args.gymId).toBe('gym-1');
    expect(args.instructorId).toBe('coach-1');
    expect(args.months).toBe(2);
    expect(args.memberId).toBe('member-1');
    expect(args.reference).toBe('GFI-backstop-1');
  });

  it('ignores an instructor charge with months out of [1,24] (no fulfilment, falls through)', async () => {
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GFI-bad',
        customer: { email: 'member@example.com' },
        metadata: { gym_id: 'gym-1', instructor_id: 'coach-1', months: 99 },
      },
    }));
    expect(res.status).toBe(200);
    expect(instructorSubFulfilMock).not.toHaveBeenCalled();
  });

  it('does NOT treat a membership charge (has plan_id) as an instructor sub', async () => {
    // plan_id present → membership path, NOT instructor. instructor backstop
    // requires the ABSENCE of plan_id.
    const res = await POST(buildRequest({
      event: 'charge.success',
      data: {
        reference: 'GF-membership',
        customer: { email: 'member@example.com' },
        metadata: { plan_id: 'plan-1', gym_id: 'gym-1', instructor_id: 'coach-1', months: 2 },
      },
    }));
    expect(res.status).toBe(200);
    expect(instructorSubFulfilMock).not.toHaveBeenCalled();
  });
});

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
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'c@e.com', phone: '+234123', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
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
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'c@e.com', phone: '+234123', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
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
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'c@e.com', phone: '+234123', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
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

  it('transfer.success sends email + WhatsApp to the coach on a fresh transition', async () => {
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'coach@example.com', phone: '+2348100000000', full_name: 'Ada Lovelace', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
    await POST(buildRequest({ event: 'transfer.success', data: { transfer_code: 'TRF_notify' } }));
    expect(emailMocks.sendPayoutPaid).toHaveBeenCalledTimes(1);
    expect(waMocks.waPayoutPaid).toHaveBeenCalledTimes(1);
    const emailArg = emailMocks.sendPayoutPaid.mock.calls[0]![1];
    expect(emailArg.name).toBe('Ada');
    expect(emailArg.amount).toBe(50000);
    expect(emailArg.bankName).toBe('GTBank');
    // PII: only last 4 digits in the message body.
    expect(emailArg.accountLast4).toBe('6789');
  });

  it('Paystack webhook retry (status already = newStatus) does NOT re-notify', async () => {
    // Paystack guarantees at-least-once delivery. The same transfer.success
    // arriving twice must not double-email the coach.
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'paid', // already paid
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'coach@example.com', phone: '+2348100000000', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
    await POST(buildRequest({ event: 'transfer.success', data: { transfer_code: 'TRF_retry' } }));
    expect(emailMocks.sendPayoutPaid).not.toHaveBeenCalled();
    expect(waMocks.waPayoutPaid).not.toHaveBeenCalled();
  });

  it('transfer.failed → sends the failure notification (not the success one)', async () => {
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 25000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'coach@example.com', phone: '+2348100000000', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
    await POST(buildRequest({ event: 'transfer.failed', data: { transfer_code: 'TRF_fail' } }));
    expect(emailMocks.sendPayoutFailed).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendPayoutFailed.mock.calls[0]![1].reason).toBe('failed');
    expect(emailMocks.sendPayoutPaid).not.toHaveBeenCalled();
  });

  it('transfer.reversed → sends failure notification with reason=reversed', async () => {
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 25000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'coach@example.com', phone: '+2348100000000', full_name: 'Ada', first_name: 'Ada', notification_email: true, notification_whatsapp: true },
    });
    await POST(buildRequest({ event: 'transfer.reversed', data: { transfer_code: 'TRF_rev' } }));
    expect(emailMocks.sendPayoutFailed.mock.calls[0]![1].reason).toBe('reversed');
  });

  it('honours notification opt-outs — neither email nor WhatsApp sent when both flags are false', async () => {
    state.transferLookup.push({
      id: 'pay-1', instructor_id: 'coach-1', amount: 50000, status: 'approved',
      bank_name: 'GTBank', account_number: '0123456789',
      profiles: { email: 'coach@example.com', phone: '+2348100000000', full_name: 'Ada', first_name: 'Ada', notification_email: false, notification_whatsapp: false },
    });
    await POST(buildRequest({ event: 'transfer.success', data: { transfer_code: 'TRF_optout' } }));
    expect(emailMocks.sendPayoutPaid).not.toHaveBeenCalled();
    expect(waMocks.waPayoutPaid).not.toHaveBeenCalled();
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
