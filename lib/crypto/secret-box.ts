import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'crypto';

// Authenticated encryption for secrets we must store and later USE — vendor API
// keys, principally. Hashing is not an option here: the AI adapter has to send
// the real key to the provider, so it has to be able to get it back.
//
// AES-256-GCM. Format is v1.<iv>.<tag>.<ciphertext>, all base64url, with the
// version prefix so a future key rotation or algorithm change can be told apart
// from ciphertext written today rather than guessed at.
//
// The key comes from SECRETS_ENCRYPTION_KEY: 32 bytes, base64 or hex. Generate
// with `openssl rand -base64 32`. Without it, encryption REFUSES rather than
// falling back to plaintext — a silent downgrade would put vendor keys in the
// database in the clear, and nobody would notice until a backup leaked.

const VERSION = 'v1';

function key(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) throw new Error('SECRETS_ENCRYPTION_KEY is not set — cannot store provider API keys.');
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32).');
  }
  return buf;
}

// True when a key is configured and usable. Callers use this to disable the
// "paste an API key" UI with an explanation instead of throwing at submit.
export function secretsConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

// Returns null rather than throwing on anything malformed, tampered, or written
// under a key we no longer hold. The callers are request paths where a bad
// stored key should degrade the assistant to the scripted menu, not 500 a
// member's WhatsApp reply.
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Shown in the admin UI so an owner can confirm WHICH key is installed without
// it being readable. Last four characters only, like a card.
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? '••••' : `••••${plaintext.slice(-4)}`;
}

// ── One-way codes ──────────────────────────────────────────────────────────
// Email OTPs are stored as SHA-256 and compared in constant time. They are
// short-lived, single-use, six digits, and rate-limited by an attempt counter,
// so a fast hash is the right choice — a slow KDF here would only add latency
// to every verification without changing what an attacker can do.
export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function codeMatches(code: string, hash: string): boolean {
  const a = Buffer.from(hashCode(code), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Cryptographically random numeric code. Rejection sampling keeps the digits
// uniform — `% 1_000_000` on a 32-bit draw would bias the low end.
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, '0');
  }
}
