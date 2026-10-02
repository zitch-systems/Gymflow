export type RefundAwarePayment = {
  amount?: number | string | null;
  refunded_amount?: number | string | null;
  payment_status?: string | null;
};

export type PaymentAmounts = {
  gross: number;
  refunded: number;
  net: number;
  refundState: 'none' | 'partial' | 'full';
};

const money = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

/** Gross stays immutable; every spending/revenue surface uses this net amount. */
export function paymentAmounts(payment: RefundAwarePayment): PaymentAmounts {
  const gross = money(payment.amount);
  const refunded = Math.min(money(payment.refunded_amount), gross);
  const net = Math.max(gross - refunded, 0);
  const refundState = refunded <= 0
    ? 'none'
    : refunded >= gross
      ? 'full'
      : 'partial';
  return { gross, refunded, net, refundState };
}

export function paymentStatusLabel(payment: RefundAwarePayment): string {
  const { refundState } = paymentAmounts(payment);
  if (refundState === 'partial') return 'Partially refunded';
  if (refundState === 'full' || payment.payment_status === 'refunded') return 'Refunded';
  const labels: Record<string, string> = {
    successful: 'Successful',
    pending: 'Pending',
    failed: 'Failed',
  };
  return labels[payment.payment_status ?? ''] ?? payment.payment_status ?? '—';
}
