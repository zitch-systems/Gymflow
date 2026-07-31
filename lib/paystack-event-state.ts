// Pure state-transition guards for asynchronous Paystack events.
//
// Kept free of server-only imports so delayed/out-of-order event behavior can
// be unit-tested without a Supabase client.

export type TransferEventName = 'transfer.success' | 'transfer.failed' | 'transfer.reversed';

type TransferGuard = {
  event: string;
  currentStatus: string;
  currentTransferCode: string | null;
  eventTransferCode: string | null;
};

/**
 * Whether a transfer event may move the current payout row.
 *
 * Paystack events can arrive late and out of order. A code from an older
 * attempt must never mutate a newer in-flight transfer, a late failure must not
 * demote a confirmed payment, and a reversal may reopen a paid row because the
 * bank returned the money.
 */
export function shouldApplyTransferEvent({
  event,
  currentStatus,
  currentTransferCode,
  eventTransferCode,
}: TransferGuard): boolean {
  if (
    eventTransferCode &&
    currentTransferCode &&
    eventTransferCode !== currentTransferCode
  ) {
    return false;
  }

  switch (event as TransferEventName) {
    case 'transfer.success':
      // requested covers a late success after an earlier failure notification
      // reopened the same attempt. Financial truth wins: the money landed.
      return currentStatus === 'approved' || currentStatus === 'requested';
    case 'transfer.failed':
      // Failure only ends an in-flight attempt; never regress paid → requested.
      return currentStatus === 'approved';
    case 'transfer.reversed':
      // A reversal can follow either an in-flight or completed transfer.
      return currentStatus === 'approved' || currentStatus === 'paid';
    default:
      return false;
  }
}

/**
 * Match a settled amount to the checkout snapshot stamped into metadata.
 *
 * Missing expected_amount_kobo is accepted for transactions initialized before
 * the field shipped. Once present, malformed or mismatched values fail closed.
 */
export function settledAmountMatches(receivedKobo: number, expectedAmountKobo: unknown): boolean {
  if (expectedAmountKobo == null) return true;
  const expected = Number(expectedAmountKobo);
  return Number.isSafeInteger(receivedKobo) &&
    receivedKobo > 0 &&
    Number.isSafeInteger(expected) &&
    expected > 0 &&
    receivedKobo === expected;
}
