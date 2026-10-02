import { describe, expect, it } from 'vitest';
import { paymentAmounts, paymentStatusLabel } from '@/lib/payment-display';

describe('paymentAmounts', () => {
  it('keeps gross immutable and subtracts a partial refund from net spend', () => {
    const payment = { amount: 10_000, refunded_amount: 2_500, payment_status: 'successful' };
    expect(paymentAmounts(payment)).toEqual({ gross: 10_000, refunded: 2_500, net: 7_500, refundState: 'partial' });
    expect(paymentStatusLabel(payment)).toBe('Partially refunded');
  });

  it('shows a full refund as zero net spend', () => {
    const payment = { amount: '10000', refunded_amount: '10000', payment_status: 'refunded' };
    expect(paymentAmounts(payment)).toEqual({ gross: 10_000, refunded: 10_000, net: 0, refundState: 'full' });
    expect(paymentStatusLabel(payment)).toBe('Refunded');
  });

  it('does not allow malformed refund data to produce negative revenue', () => {
    expect(paymentAmounts({ amount: 100, refunded_amount: 150, payment_status: 'successful' }))
      .toEqual({ gross: 100, refunded: 100, net: 0, refundState: 'full' });
  });
});
