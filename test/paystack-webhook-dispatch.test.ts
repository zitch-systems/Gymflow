import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  fulfill: vi.fn(),
  confirm: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('@/lib/paystack-fulfill', () => ({ fulfillCharge: calls.fulfill }));
vi.mock('@/lib/platform-fulfill', () => ({
  isPlatformEvent: () => false,
  handlePlatformEvent: vi.fn(),
}));
vi.mock('@/lib/paystack-refund', () => ({
  isRefundEvent: () => false,
  handleRefundEvent: vi.fn(),
}));
vi.mock('@/lib/member-sub-fulfill', () => ({
  isMemberSubEvent: async () => false,
  handleMemberSubEvent: vi.fn(),
}));
vi.mock('@/lib/transfer-fulfill', () => ({
  isTransferEvent: () => false,
  handleTransferEvent: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ kind: 'admin' }) }));
vi.mock('@/lib/whatsapp/notify', () => ({ confirmWhatsAppPayment: calls.confirm }));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: calls.capture }));

import { eventReference, processPaystackEvent } from '@/lib/paystack-webhook';

describe('Paystack event reference extraction', () => {
  it('finds refund references in both provider payload shapes', () => {
    expect(eventReference({ event: 'refund.processed', data: { transaction_reference: 'ref_refund' } }))
      .toBe('ref_refund');
    expect(eventReference({ event: 'charge.refund', data: { transaction: { reference: 'ref_nested' } } }))
      .toBe('ref_nested');
  });
});

describe('Paystack webhook dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.fulfill.mockResolvedValue({ ok: true, created: true });
    calls.confirm.mockResolvedValue({ delivered: true });
  });

  it('passes verified charge data, split settlement, and member identity to fulfillment and confirmation', async () => {
    const result = await processPaystackEvent({
      event: 'charge.success',
      data: {
        reference: 'ref_fixture', amount: 250_000, currency: 'NGN', channel: 'card',
        metadata: { member_id: 'member_fixture', gym_id: 'gym_fixture' },
        subaccount: { subaccount_code: 'ACCT_fixture' },
        fees_split: { integration: 25_000 },
      },
    });

    expect(result).toEqual({ outcome: 'completed', status: 200 });
    expect(calls.fulfill).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'ref_fixture', amountKobo: 250_000, currency: 'NGN', channel: 'card',
      metadata: { member_id: 'member_fixture', gym_id: 'gym_fixture' },
      split: expect.objectContaining({ settlement: 'split', amountNaira: 250 }),
    }));
    expect(calls.confirm).toHaveBeenCalledWith(
      { kind: 'admin' },
      { reference: 'ref_fixture', amountKobo: 250_000, memberId: 'member_fixture', gymId: 'gym_fixture' },
    );
  });

  it('does not send a duplicate confirmation when fulfillment was already recorded', async () => {
    calls.fulfill.mockResolvedValue({ ok: true, created: false });

    expect(await processPaystackEvent({ event: 'charge.success', data: { reference: 'ref_replay' } }))
      .toEqual({ outcome: 'completed', status: 200 });
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it('returns an honest failure status and records a durable incident on permanent failure', async () => {
    calls.fulfill.mockResolvedValue({ ok: false, permanent: true, error: 'invalid metadata' });

    expect(await processPaystackEvent({ event: 'charge.success', data: { reference: 'ref_bad' } }))
      .toEqual({ outcome: 'permanent_failure', status: 422, error: 'invalid metadata' });
    expect(calls.capture).toHaveBeenCalledWith(
      'paystack webhook fulfill failed',
      { event: 'charge.success', error: 'invalid metadata', reference: 'ref_bad' },
    );
  });
});
