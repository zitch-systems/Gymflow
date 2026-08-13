import { afterEach, describe, expect, it } from 'vitest';

// Provider API keys are stored encrypted because they must be USED, not just
// checked — hashing is not an option. What matters is that a leaked row is
// worthless without the server key, and that a bad or rotated key degrades to
// "no key" rather than throwing inside a member's WhatsApp reply.

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

async function load() {
  // Re-import per test so the module picks up the current env.
  return import('@/lib/crypto/secret-box');
}

afterEach(() => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a vendor key', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const { encryptSecret, decryptSecret } = await load();
    const secret = 'sk-ant-api03-abcdef123456';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces different ciphertext each time, so equal keys are not linkable', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const { encryptSecret } = await load();
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('carries a version prefix so a future scheme change is distinguishable', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const { encryptSecret } = await load();
    expect(encryptSecret('x').startsWith('v1.')).toBe(true);
  });

  // A silent plaintext fallback would put vendor keys in the database in the
  // clear and nobody would notice until a backup leaked.
  it('refuses to encrypt without a configured key rather than storing plaintext', async () => {
    const { encryptSecret, secretsConfigured } = await load();
    expect(secretsConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  it('rejects a key that is not 32 bytes', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    const { encryptSecret } = await load();
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('returns null — never throws — for ciphertext written under another key', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const { encryptSecret } = await load();
    const blob = encryptSecret('secret');
    process.env.SECRETS_ENCRYPTION_KEY = OTHER_KEY;
    const { decryptSecret } = await import('@/lib/crypto/secret-box');
    expect(decryptSecret(blob)).toBeNull();
  });

  it('returns null for tampered, malformed and empty input', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const { encryptSecret, decryptSecret } = await load();
    const blob = encryptSecret('secret');
    const parts = blob.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(decryptSecret(parts.join('.'))).toBeNull();
    expect(decryptSecret('garbage')).toBeNull();
    expect(decryptSecret('v2.a.b.c')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
});

describe('numericCode / hashCode', () => {
  it('produces codes of the requested length, digits only', async () => {
    const { numericCode } = await load();
    for (let i = 0; i < 50; i++) expect(numericCode(6)).toMatch(/^\d{6}$/);
  });

  it('stores only a hash, and matches in constant time', async () => {
    const { hashCode, codeMatches } = await load();
    const hash = hashCode('123456');
    expect(hash).not.toContain('123456');
    expect(codeMatches('123456', hash)).toBe(true);
    expect(codeMatches('123457', hash)).toBe(false);
  });

  it('ignores surrounding whitespace a member may paste in', async () => {
    const { hashCode, codeMatches } = await load();
    expect(codeMatches(' 123456 ', hashCode('123456'))).toBe(true);
  });

  it('survives a comparison against a hash of the wrong length', async () => {
    const { codeMatches } = await load();
    expect(codeMatches('123456', 'abcd')).toBe(false);
  });

  // Rejection sampling, not `% 1_000_000` on a 32-bit draw, which biases low.
  it('spreads codes across the whole space', async () => {
    const { numericCode } = await load();
    const seen = new Set(Array.from({ length: 400 }, () => numericCode(6)));
    expect(seen.size).toBeGreaterThan(390);
  });
});

describe('secretHint', () => {
  it('shows only the last four characters', async () => {
    const { secretHint } = await load();
    expect(secretHint('sk-ant-api03-abcdef1234')).toBe('••••1234');
    expect(secretHint('abc')).toBe('••••');
  });
});
