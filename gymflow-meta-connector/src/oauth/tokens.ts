/**
 * Access and refresh tokens — signed and stateless (see sign.ts for why).
 *
 * Both carry an audience (`aud`), set from the RFC 8707 `resource` the client
 * asked for and checked again when the token is used. That binding is what
 * stops a token minted for this connector being replayed against some other
 * MCP server that happens to trust the same operator — the confused-deputy
 * problem the resource indicator exists to close.
 *
 * WHAT STATELESS COSTS, stated plainly: there is no revocation list, so a
 * token stays valid until it expires. Refreshing returns a NEW refresh token
 * (each carries a random `jti`, so no two are alike), but it does NOT
 * invalidate the previous one — real rotation with reuse-detection needs a
 * server-side record of spent tokens, and that record would be lost on every
 * redeploy, signing the operator out each time. For a single-operator,
 * read-only maintenance tool that trade is worth making; the escape hatch is
 * that every token is signed with `oauthSigningKey`, so rotating
 * CONNECTOR_API_KEY (or OAUTH_SIGNING_KEY) invalidates every outstanding
 * token everywhere, immediately. That is the revocation mechanism.
 */
import { randomBytes } from 'node:crypto';

import { sign, verify } from './sign.js';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface TokenPayload extends Record<string, unknown> {
  typ: 'access' | 'refresh';
  cid: string;
  scope: string;
  aud: string | undefined;
  exp: number;
  iat: number;
  jti: string;
}

export interface TokenClaims {
  clientId: string;
  scope: string;
  audience: string | undefined;
  tokenId?: string;
}

function issue(
  typ: TokenPayload['typ'],
  claims: TokenClaims,
  key: string,
  ttlSeconds: number,
  now: number,
): string {
  const iat = Math.floor(now / 1000);
  const payload: TokenPayload = {
    typ,
    cid: claims.clientId,
    scope: claims.scope,
    aud: claims.audience,
    iat,
    exp: iat + ttlSeconds,
    jti: randomBytes(12).toString('base64url'),
  };
  return sign(payload, key);
}

export function issueAccessToken(claims: TokenClaims, key: string, now: number = Date.now()): string {
  return issue('access', claims, key, ACCESS_TOKEN_TTL_SECONDS, now);
}

export function issueRefreshToken(claims: TokenClaims, key: string, now: number = Date.now()): string {
  return issue('refresh', claims, key, REFRESH_TOKEN_TTL_SECONDS, now);
}

function verifyTyped(
  token: string,
  key: string,
  expected: TokenPayload['typ'],
  now: number,
): TokenClaims | undefined {
  const payload = verify<TokenPayload>(token, key, now);
  if (!payload || payload.typ !== expected) return undefined;
  if (typeof payload.cid !== 'string' || typeof payload.scope !== 'string') return undefined;
  return {
    clientId: payload.cid,
    scope: payload.scope,
    audience: typeof payload.aud === 'string' ? payload.aud : undefined,
    ...(typeof payload.jti === 'string' ? { tokenId: payload.jti } : {}),
  };
}

export function verifyAccessToken(
  token: string,
  key: string,
  expectedAudience?: string,
  now: number = Date.now(),
): TokenClaims | undefined {
  const claims = verifyTyped(token, key, 'access', now);
  if (!claims) return undefined;
  if (claims.audience && expectedAudience && claims.audience !== expectedAudience) return undefined;
  return claims;
}

export function verifyRefreshToken(
  token: string,
  key: string,
  now: number = Date.now(),
): TokenClaims | undefined {
  return verifyTyped(token, key, 'refresh', now);
}
