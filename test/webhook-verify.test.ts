import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyPaystackSignature, webhookBodyHash } from '@/lib/webhook-verify';

// The webhook's outer gate. A signature bug here either lets forged money
// events in (verify too loose) or drops real charges (too strict) — the most
// consequential few lines in the payment path.

const SECRET = 'sk_test_webhook_secret';
const sign = (raw: string, secret = SECRET) => createHmac('sha512', secret).update(raw).digest('hex');

describe('verifyPaystackSignature', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1', amount: 500000 } });

  it('accepts the correct HMAC-SHA512 signature', () => {
    expect(verifyPaystackSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    expect(verifyPaystackSignature(body, sign(body, 'sk_wrong'), SECRET)).toBe(false);
  });

  it('rejects when the body was tampered after signing', () => {
    const tampered = body.replace('500000', '100');
    expect(verifyPaystackSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it('rejects an empty or truncated signature without throwing', () => {
    expect(verifyPaystackSignature(body, '', SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, sign(body).slice(0, 20), SECRET)).toBe(false);
  });

  it('is byte-exact: a case-flipped signature is rejected', () => {
    expect(verifyPaystackSignature(body, sign(body).toUpperCase(), SECRET)).toBe(false);
  });
});

describe('webhookBodyHash', () => {
  it('is stable for the same body (a replay maps to the same ledger key)', () => {
    const raw = '{"event":"subscription.disable","data":{"subscription_code":"SUB_x"}}';
    expect(webhookBodyHash(raw)).toBe(webhookBodyHash(raw));
  });

  it('differs for different bodies', () => {
    expect(webhookBodyHash('{"a":1}')).not.toBe(webhookBodyHash('{"a":2}'));
  });

  it('namespaces by provider so a second provider cannot collide', () => {
    expect(webhookBodyHash('{"a":1}', 'paystack')).not.toBe(webhookBodyHash('{"a":1}', 'other'));
  });

  it('emits sha256 hex (64 lowercase hex chars)', () => {
    expect(webhookBodyHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
