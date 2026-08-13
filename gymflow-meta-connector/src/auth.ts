import type { NextFunction, Request, Response } from 'express';

import type { Config } from './config.js';
import { safeEqualString } from './oauth/sign.js';
import { verifyAccessToken } from './oauth/tokens.js';
import { resourceUri } from './oauth/router.js';

function bearerToken(req: Request): string | undefined {
  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || undefined;
  return undefined;
}

function extractKey(req: Request): string | undefined {
  const bearer = bearerToken(req);
  if (bearer) return bearer;
  const header = req.header('x-connector-api-key');
  return header?.trim() || undefined;
}

export interface AuthResult {
  ok: boolean;
  keyFingerprint: string;
  method: 'api_key' | 'oauth' | 'none';
}

export function checkAuth(req: Request, config: Config): AuthResult {
  const presented = extractKey(req);
  if (!presented) {
    return { ok: false, keyFingerprint: '(none)', method: 'none' };
  }
  const keyFingerprint = presented.slice(0, 6);

  if (safeEqualString(presented, config.connectorApiKey)) {
    return { ok: true, keyFingerprint, method: 'api_key' };
  }

  const bearer = bearerToken(req);
  if (bearer) {
    const claims = verifyAccessToken(bearer, config.oauthSigningKey, resourceUri(req, config));
    if (claims) {
      return { ok: true, keyFingerprint: claims.tokenId?.slice(0, 8) ?? 'oauth', method: 'oauth' };
    }
  }

  return { ok: false, keyFingerprint, method: 'none' };
}

export function requireApiKey(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = checkAuth(req, config);
    res.locals.keyFingerprint = result.keyFingerprint;
    res.locals.authMethod = result.method;
    if (!result.ok) {
      const metadataUrl = `${resourceUri(req, config).replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource`;
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer realm="gymflow-meta-connector", resource_metadata="${metadataUrl}"`,
        )
        .json({
          error: 'unauthorized',
          message:
            'Authentication required: present an OAuth 2.1 access token or the CONNECTOR_API_KEY.',
        });
      return;
    }
    next();
  };
}
