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

// ── Standard Webhooks (Svix) ─────────────────────────────────────────────────
//
// Used by Supabase's Send Email hook and by Resend's delivery webhooks. It is a
// different scheme from Paystack's in every dimension — SHA-256 not SHA-512,
// base64 not hex, the signed content is `id.timestamp.body` rather than the bare
// body, the secret is base64 behind a `whsec_` prefix, and the header can carry
// several space-separated signatures during a secret rotation. So it gets its
// own verifier rather than a parameterised version of the Paystack one.
//
// The timestamp check is the part that actually matters here: without it a
// captured request stays replayable forever, and for the auth hook that means
// re-sending someone else's password-reset link on demand.

/** How far a webhook-timestamp may be from our clock, in seconds. The Standard
 *  Webhooks spec recommends 5 minutes; it absorbs ordinary clock skew while
 *  keeping the replay window short. */
const TOLERANCE_SECONDS = 300;

export type StandardWebhookHeaders = { id: string; timestamp: string; signature: string };

/**
 * Verify a Standard Webhooks signature.
 *
 * @param raw       the exact request body, unparsed — re-serialising JSON changes
 *                  bytes and breaks the MAC
 * @param headers   webhook-id / webhook-timestamp / webhook-signature (Svix sends
 *                  the same values as svix-id / svix-timestamp / svix-signature)
 * @param secret    the endpoint secret, with or without the `whsec_` prefix
 * @param nowSeconds injectable clock so the replay window is testable
 */
export function verifyStandardWebhook(
  raw: string,
  headers: StandardWebhookHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  // `whsec_` prefixes a base64 key. A secret without the prefix is treated as
  // raw bytes so a caller that already stripped it still works.
  const keyBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'base64');
  if (keyBytes.length === 0) return false;

  const expected = createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${raw}`).digest();

  // The header is a space-separated list of `<version>,<base64sig>` pairs; more
  // than one appears while an endpoint secret is being rotated. Any v1 match is
  // a pass. Every candidate is compared in constant time, and the loop is not
  // short-circuited on length mismatch beyond what timingSafeEqual requires.
  let matched = false;
  for (const part of signature.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    const provided = Buffer.from(part.slice(comma + 1), 'base64');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) matched = true;
  }
  return matched;
}

/** Pull Standard Webhooks headers off a request, accepting both the spec names
 *  and Svix's original `svix-*` ones (Resend sends `svix-*`, Supabase sends
 *  `webhook-*`). */
export function standardWebhookHeaders(h: Headers): StandardWebhookHeaders {
  return {
    id: h.get('webhook-id') ?? h.get('svix-id') ?? '',
    timestamp: h.get('webhook-timestamp') ?? h.get('svix-timestamp') ?? '',
    signature: h.get('webhook-signature') ?? h.get('svix-signature') ?? '',
  };
}
