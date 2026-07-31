import { describe, expect, it } from 'vitest';
import { settledAmountMatches, shouldApplyTransferEvent } from '@/lib/paystack-event-state';

const guard = (
  event: string,
  currentStatus: string,
  currentTransferCode: string | null = 'TRF_current',
  eventTransferCode: string | null = 'TRF_current',
) => shouldApplyTransferEvent({ event, currentStatus, currentTransferCode, eventTransferCode });

describe('shouldApplyTransferEvent', () => {
  it('accepts a success for the in-flight attempt', () => {
    expect(guard('transfer.success', 'approved')).toBe(true);
  });

  it('does not send a confirmed payout backwards on a delayed failure', () => {
    expect(guard('transfer.failed', 'paid')).toBe(false);
  });

  it('reopens only an in-flight payout on failure', () => {
    expect(guard('transfer.failed', 'approved')).toBe(true);
    expect(guard('transfer.failed', 'requested')).toBe(false);
  });

  it('reopens a paid payout when the bank reverses the transfer', () => {
    expect(guard('transfer.reversed', 'paid')).toBe(true);
  });

  it('rejects an event from an older transfer attempt', () => {
    expect(guard('transfer.failed', 'approved', 'TRF_new', 'TRF_old')).toBe(false);
    expect(guard('transfer.success', 'approved', 'TRF_new', 'TRF_old')).toBe(false);
  });

  it('accepts a late success after the same attempt was reopened', () => {
    expect(guard('transfer.success', 'requested', null, 'TRF_old')).toBe(true);
  });

  it('rejects duplicate success and unknown event names', () => {
    expect(guard('transfer.success', 'paid')).toBe(false);
    expect(guard('transfer.pending', 'approved')).toBe(false);
  });
});

describe('settledAmountMatches', () => {
  it('accepts the exact checkout snapshot', () => {
    expect(settledAmountMatches(500_000, 500_000)).toBe(true);
  });

  it('rejects underpayment, overpayment, and malformed snapshots', () => {
    expect(settledAmountMatches(100, 500_000)).toBe(false);
    expect(settledAmountMatches(600_000, 500_000)).toBe(false);
    expect(settledAmountMatches(500_000, 'not-a-number')).toBe(false);
  });

  it('keeps pre-snapshot transactions backward compatible', () => {
    expect(settledAmountMatches(500_000, undefined)).toBe(true);
  });
});
