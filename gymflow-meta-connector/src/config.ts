import { createHmac } from 'node:crypto';

import type { StaticClient } from './oauth/clients.js';

export interface Config {
  metaAccessToken: string;
  metaWabaId: string;
  metaPhoneNumberId: string;
  metaAppId: string | undefined;
  metaAppSecret: string | undefined;
  connectorApiKey: string;
  port: number;
  graphApiVersion: string;
  graphApiBaseUrl: string;
  graphTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  ipRateLimitMaxRequests: number;
  readOnly: boolean;
  requireWriteConfirmation: boolean;
  publicBaseUrl: string | undefined;
  oauthSigningKey: string;
  oauthLoginPassword: string;
  oauthAllowedRedirectHosts: readonly string[];
  oauthStaticClient: StaticClient | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Environment variable ${name} must be true/false, got: ${raw}`);
}

function listEnv(name: string): string[] | undefined {
  const raw = optionalEnv(name);
  if (!raw) return undefined;
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function staticClient(): StaticClient | undefined {
  const clientId = optionalEnv('OAUTH_CLIENT_ID');
  const clientSecret = optionalEnv('OAUTH_CLIENT_SECRET');
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new Error('OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be set together, or neither.');
  }
  if (clientSecret.length < 24) {
    throw new Error(
      'OAUTH_CLIENT_SECRET is too short (< 24 chars) — generate one with `openssl rand -hex 32`.',
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUris: listEnv('OAUTH_REDIRECT_URIS') ?? [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
    ],
  };
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;

  const connectorApiKey = requireEnv('CONNECTOR_API_KEY');
  if (connectorApiKey.length < 24) {
    throw new Error(
      'CONNECTOR_API_KEY is too short (< 24 chars) — generate one with ' +
        "`openssl rand -hex 32` so it can't be brute-forced.",
    );
  }

  const graphApiBaseUrl = optionalEnv('META_GRAPH_API_BASE_URL') ?? 'https://graph.facebook.com';
  if (!graphApiBaseUrl.startsWith('https://')) {
    throw new Error(
      `META_GRAPH_API_BASE_URL must start with https:// (got: ${graphApiBaseUrl}) — ` +
        'the access token is sent in a header on every request and must never travel over plain HTTP.',
    );
  }

  cached = {
    metaAccessToken: requireEnv('META_ACCESS_TOKEN'),
    metaWabaId: requireEnv('META_WABA_ID'),
    metaPhoneNumberId: requireEnv('META_PHONE_NUMBER_ID'),
    metaAppId: optionalEnv('META_APP_ID'),
    metaAppSecret: optionalEnv('META_APP_SECRET'),
    connectorApiKey,
    port: intEnv('PORT', 8787),
    graphApiVersion: optionalEnv('META_GRAPH_API_VERSION') ?? 'v21.0',
    graphApiBaseUrl,
    graphTimeoutMs: intEnv('GRAPH_TIMEOUT_MS', 10_000),
    rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMaxRequests: intEnv('RATE_LIMIT_MAX_REQUESTS', 30),
    ipRateLimitMaxRequests: intEnv('IP_RATE_LIMIT_MAX_REQUESTS', 60),
    readOnly: !boolEnv('META_ALLOW_WRITES', false),
    requireWriteConfirmation: boolEnv('META_REQUIRE_WRITE_CONFIRMATION', true),
    publicBaseUrl: optionalEnv('PUBLIC_BASE_URL'),
    oauthSigningKey:
      optionalEnv('OAUTH_SIGNING_KEY') ??
      createHmac('sha256', connectorApiKey).update('gymflow-meta-connector/oauth-signing').digest('hex'),
    oauthLoginPassword: optionalEnv('OAUTH_LOGIN_PASSWORD') ?? connectorApiKey,
    oauthAllowedRedirectHosts: listEnv('OAUTH_ALLOWED_REDIRECT_HOSTS') ?? [
      'claude.ai',
      'claude.com',
      'localhost',
      '127.0.0.1',
    ],
    oauthStaticClient: staticClient(),
  };
  if (cached.ipRateLimitMaxRequests < cached.rateLimitMaxRequests) {
    throw new Error(
      'IP_RATE_LIMIT_MAX_REQUESTS must be >= RATE_LIMIT_MAX_REQUESTS.',
    );
  }
  return cached;
}

export function _resetConfigForTests(): void {
  cached = undefined;
}
