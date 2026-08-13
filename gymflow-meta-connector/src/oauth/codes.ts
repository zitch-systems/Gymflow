/**
 * Authorization codes + PKCE (RFC 7636).
 *
 * These are the one thing here that is NOT a signed, stateless token, and the
 * reason is single-use: an authorization code must be redeemable exactly
 * once, and "has this already been redeemed?" is a fact you can only answer
 * from state. A signed self-contained code would stay valid for its whole
 * lifetime no matter how many times it was replayed.
 *
 * In-memory is acceptable precisely because the lifetime is ~60 seconds: the
 * window between the browser redirect and the client's token call. A restart
 * inside that window costs one retried sign-in, not a lost session (access
 * and refresh tokens are signed and survive restarts — see tokens.ts).
 *
 * PKCE is mandatory and S256-only. `plain` is refused outright: it offers no
 * protection at all against an attacker who can observe the authorization
 * request, which is the entire threat PKCE exists to address, and OAuth 2.1
 * drops it.
 */
import { createHash, randomBytes } from 'node:crypto';

import { b64uEncode, safeEqualString } from './sign.js';

export interface AuthorizationCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | undefined;
  expiresAt: number;
}

const CODE_TTL_MS = 60_000;

export class AuthorizationCodeStore {
  private readonly codes = new Map<string, AuthorizationCode>();

  issue(entry: Omit<AuthorizationCode, 'expiresAt'>, now: number = Date.now()): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { ...entry, expiresAt: now + CODE_TTL_MS });
    return code;
  }

  redeem(code: string, now: number = Date.now()): AuthorizationCode | undefined {
    const entry = this.codes.get(code);
    if (!entry) return undefined;
    this.codes.delete(code);
    if (now >= entry.expiresAt) return undefined;
    return entry;
  }

  sweep(now: number = Date.now()): void {
    for (const [code, entry] of this.codes) {
      if (now >= entry.expiresAt) this.codes.delete(code);
    }
  }

  get size(): number {
    return this.codes.size;
  }
}

export function s256(verifier: string): string {
  return b64uEncode(createHash('sha256').update(verifier, 'ascii').digest());
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128) return false;
  return safeEqualString(s256(verifier), challenge);
}

export function startCodeSweep(store: AuthorizationCodeStore, intervalMs = 60_000): () => void {
  const timer = setInterval(() => store.sweep(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
