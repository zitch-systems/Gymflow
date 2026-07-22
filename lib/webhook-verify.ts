import { createHash, createHmac, timingSafeEqual } from 'crypto';

// Pure webhook-verification helpers. Deliberately NOT 'server-only' so the
// vitest suite can exercise them directly; they hold no secrets themselves
// (the caller passes the key in).

// Paystack signs the raw body with HMAC-SHA512 of the account's secret key.
// Constant-time compare so the check can't leak the expected signature
// byte-by-byte via timing.
export function verifyPaystackSignature(raw: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha512', secret).update(raw).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

// Stable identity for a webhook delivery: a replay is byte-identical, so the
// hash of the raw body IS the event identity. Prefixed with the provider so a
// second provider's ledger entries can never collide with Paystack's.
export function webhookBodyHash(raw: string, provider = 'paystack'): string {
  return createHash('sha256').update(`${provider}:${raw}`).digest('hex');
}
