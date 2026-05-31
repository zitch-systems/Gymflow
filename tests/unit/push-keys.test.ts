import { describe, it, expect, vi } from 'vitest';
import { urlBase64ToUint8Array, isDeadSubscriptionStatus } from '@/lib/push-keys';

describe('isDeadSubscriptionStatus', () => {
  it('treats 404 and 410 as dead (prune)', () => {
    expect(isDeadSubscriptionStatus(404)).toBe(true);
    expect(isDeadSubscriptionStatus(410)).toBe(true);
  });
  it('treats transient/other statuses as alive (keep)', () => {
    for (const s of [200, 201, 400, 401, 429, 500, 503]) {
      expect(isDeadSubscriptionStatus(s)).toBe(false);
    }
  });
});

describe('urlBase64ToUint8Array', () => {
  // atob isn't defined in the node test env by default; stub it.
  vi.stubGlobal('atob', (b64: string) => Buffer.from(b64, 'base64').toString('binary'));

  it('decodes a base64url string into the raw bytes', () => {
    // "hello" => base64 "aGVsbG8="; base64url drops padding
    const out = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(out)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles base64url -+_ substitutions', () => {
    // bytes [251, 255] => base64 "+/8=" => base64url "-_8"
    const out = urlBase64ToUint8Array('-_8');
    expect(Array.from(out)).toEqual([251, 255]);
  });

  it('round-trips an 87-char VAPID-length key without throwing', () => {
    const key = 'B' + 'A'.repeat(86); // typical applicationServerKey length
    expect(() => urlBase64ToUint8Array(key)).not.toThrow();
  });
});
