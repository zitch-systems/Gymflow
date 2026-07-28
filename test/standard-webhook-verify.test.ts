import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyStandardWebhook, standardWebhookHeaders } from '@/lib/webhook-verify';

// Standard Webhooks (Svix) verification gates the Supabase auth-email hook and
// the Resend delivery webhook. A miss here is serious in a specific way: the
// auth hook re-sends real password-reset links, so a replayable or forgeable
// signature is a way to spray someone else's reset mail.

// A whsec_ secret is base64 behind the prefix. Build one from known bytes so
// the test signs exactly what the verifier expects.
const KEY_BYTES = Buffer.from('a-32-byte-test-signing-key-000000');
const SECRET = `whsec_${KEY_BYTES.toString('base64')}`;
const NOW = 1_700_000_000;

function sign(id: string, ts: number, body: string, key = KEY_BYTES): string {
  const mac = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${mac}`;
}

const ID = 'msg_2abc';
const BODY = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e_1' } });

describe('verifyStandardWebhook', () => {
  it('accepts a correctly signed, in-window request', () => {
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(true);
  });

  it('accepts a secret passed without the whsec_ prefix', () => {
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, KEY_BYTES.toString('base64'), NOW)).toBe(true);
  });

  // Supabase's dashboard hands out the auth-hook secret as `v1,whsec_<base64>`,
  // Resend's as `whsec_<base64>`. Base64 decoding ignores junk rather than
  // throwing, so an unstripped `v1,` used to yield a wrong-but-plausible key and
  // 401 every single auth email — signup confirmation and password reset both
  // dead, with a correct copy-paste. All three accepted forms are pinned here.
  it.each([
    ['v1,whsec_ + base64 (Supabase dashboard)', `v1,whsec_${KEY_BYTES.toString('base64')}`],
    ['whsec_ + base64 (Resend / Svix)', `whsec_${KEY_BYTES.toString('base64')}`],
    ['bare base64 (already stripped)', KEY_BYTES.toString('base64')],
    ['surrounding whitespace from a copy-paste', `  v1,whsec_${KEY_BYTES.toString('base64')}  `],
  ])('accepts the secret formatted as %s', (_label, secret) => {
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, secret, NOW)).toBe(true);
  });

  it('rejects a signature made with a different key', () => {
    const wrong = Buffer.from('different-32-byte-signing-key-0000');
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY, wrong) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('rejects when the body was tampered after signing', () => {
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY.replace('delivered', 'bounced'), headers, SECRET, NOW)).toBe(false);
  });

  it('rejects when the signed id differs from the header id (cross-message replay)', () => {
    const headers = { id: 'msg_other', timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('rejects a timestamp outside the 5-minute window (stale replay)', () => {
    const stale = NOW - 301;
    const headers = { id: ID, timestamp: String(stale), signature: sign(ID, stale, BODY) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    const future = NOW + 301;
    const headers = { id: ID, timestamp: String(future), signature: sign(ID, future, BODY) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('accepts when one of several space-separated signatures matches (secret rotation)', () => {
    const good = sign(ID, NOW, BODY);
    const headers = { id: ID, timestamp: String(NOW), signature: `v1,AAAA ${good}` };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(true);
  });

  it('ignores non-v1 signature schemes', () => {
    const mac = createHmac('sha256', KEY_BYTES).update(`${ID}.${NOW}.${BODY}`).digest('base64');
    const headers = { id: ID, timestamp: String(NOW), signature: `v2,${mac}` };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('rejects empty / missing header fields without throwing', () => {
    expect(verifyStandardWebhook(BODY, { id: '', timestamp: String(NOW), signature: sign(ID, NOW, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifyStandardWebhook(BODY, { id: ID, timestamp: '', signature: sign(ID, NOW, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifyStandardWebhook(BODY, { id: ID, timestamp: String(NOW), signature: '' }, SECRET, NOW)).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const headers = { id: ID, timestamp: 'not-a-number', signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const headers = { id: ID, timestamp: String(NOW), signature: sign(ID, NOW, BODY) };
    expect(verifyStandardWebhook(BODY, headers, '', NOW)).toBe(false);
  });
});

describe('standardWebhookHeaders', () => {
  it('reads the webhook-* header names (Supabase)', () => {
    const h = new Headers({ 'webhook-id': 'a', 'webhook-timestamp': '1', 'webhook-signature': 'v1,x' });
    expect(standardWebhookHeaders(h)).toEqual({ id: 'a', timestamp: '1', signature: 'v1,x' });
  });

  it('falls back to the svix-* header names (Resend)', () => {
    const h = new Headers({ 'svix-id': 'b', 'svix-timestamp': '2', 'svix-signature': 'v1,y' });
    expect(standardWebhookHeaders(h)).toEqual({ id: 'b', timestamp: '2', signature: 'v1,y' });
  });

  it('returns empty strings when nothing is present (verifier then rejects)', () => {
    expect(standardWebhookHeaders(new Headers())).toEqual({ id: '', timestamp: '', signature: '' });
  });
});
