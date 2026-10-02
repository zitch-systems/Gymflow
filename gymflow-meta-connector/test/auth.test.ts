import { describe, expect, it } from 'vitest';
import type { Request } from 'express';

import { checkAuth } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { issueAccessToken } from '../src/oauth/tokens.js';

const API_KEY = 'connector-api-key-at-least-24-chars';
const SIGNING_KEY = 'oauth-signing-key-at-least-24-chars';

const config: Config = {
  metaAccessToken: 'meta-token',
  metaWabaId: '123',
  metaPhoneNumberId: '456',
  metaAppId: undefined,
  metaAppSecret: undefined,
  connectorApiKey: API_KEY,
  port: 8787,
  graphApiVersion: 'v21.0',
  graphApiBaseUrl: 'https://graph.facebook.com',
  graphTimeoutMs: 10_000,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 30,
  ipRateLimitMaxRequests: 60,
  readOnly: true,
  requireWriteConfirmation: true,
  publicBaseUrl: 'https://connector.example',
  oauthSigningKey: SIGNING_KEY,
  oauthLoginPassword: API_KEY,
  oauthAllowedRedirectHosts: ['localhost'],
  oauthStaticClient: undefined,
};

function request(headers: Record<string, string> = {}): Request {
  const normalised = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    protocol: 'https',
    header(name: string) {
      return normalised[name.toLowerCase()];
    },
  } as Request;
}

describe('connector authentication', () => {
  it('accepts only the exact connector API key', () => {
    expect(checkAuth(request({ 'x-connector-api-key': API_KEY }), config)).toMatchObject({
      ok: true,
      method: 'api_key',
    });
    expect(checkAuth(request({ 'x-connector-api-key': `${API_KEY}-wrong` }), config)).toMatchObject({
      ok: false,
      method: 'none',
    });
  });

  it('accepts a signed access token bound to this MCP resource', () => {
    const token = issueAccessToken({
      clientId: 'test-client',
      scope: 'mcp:read',
      audience: 'https://connector.example/mcp',
    }, SIGNING_KEY);

    expect(checkAuth(request({ authorization: `Bearer ${token}` }), config)).toMatchObject({
      ok: true,
      method: 'oauth',
    });
  });

  it('rejects a valid token minted for another resource', () => {
    const token = issueAccessToken({
      clientId: 'test-client',
      scope: 'mcp:read',
      audience: 'https://other.example/mcp',
    }, SIGNING_KEY);

    expect(checkAuth(request({ authorization: `Bearer ${token}` }), config)).toMatchObject({
      ok: false,
      method: 'none',
    });
  });
});
