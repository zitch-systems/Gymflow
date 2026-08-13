// Which HTTP dialect each vendor speaks, and how to address it.
//
// Twenty-one providers, three request shapes. Almost the whole market has
// standardised on OpenAI's /chat/completions, so that is the default and only
// the genuine exceptions get their own branch — Anthropic (its own Messages
// API) and Google Gemini (generateContent). Everything else differs only in
// base URL and auth header, which is data, not code.
//
// Providers that need an SDK, request signing, or per-deployment routing that a
// single API key cannot express are marked 'unsupported' and are visible in the
// admin UI as "needs configuration" rather than silently failing at the first
// member message. That is deliberate: AWS Bedrock needs SigV4, Azure OpenAI
// needs a deployment-specific host, and Vertex needs a Google service account.
// Pretending a bare key is enough for those would produce a broken assistant
// that looks configured.

import type { ProviderDialect } from './types';

export type DialectSpec = {
  dialect: ProviderDialect;
  /** How the key is presented. */
  auth: 'bearer' | 'x-api-key' | 'query' | 'none';
  /** Extra static headers a vendor insists on. */
  headers?: Record<string, string>;
  /** Why it can't be used with a plain key, shown in the admin UI. */
  unsupportedReason?: string;
};

const OPENAI_COMPATIBLE: DialectSpec = { dialect: 'openai', auth: 'bearer' };

export const DIALECTS: Record<string, DialectSpec> = {
  anthropic: {
    dialect: 'anthropic',
    auth: 'x-api-key',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  google: { dialect: 'google', auth: 'query' },

  openai: OPENAI_COMPATIBLE,
  groq: OPENAI_COMPATIBLE,
  mistral: OPENAI_COMPATIBLE,
  deepseek: OPENAI_COMPATIBLE,
  xai: OPENAI_COMPATIBLE,
  cohere: OPENAI_COMPATIBLE,
  perplexity: OPENAI_COMPATIBLE,
  together: OPENAI_COMPATIBLE,
  fireworks: OPENAI_COMPATIBLE,
  cerebras: OPENAI_COMPATIBLE,
  huggingface: OPENAI_COMPATIBLE,
  moonshot: OPENAI_COMPATIBLE,
  zhipu: OPENAI_COMPATIBLE,
  alibaba: OPENAI_COMPATIBLE,
  nebius: OPENAI_COMPATIBLE,
  // Self-hosted, so usually no key at all.
  ollama: { dialect: 'openai', auth: 'none' },
  openrouter: {
    dialect: 'openai',
    auth: 'bearer',
    // OpenRouter attributes traffic by these and rate-limits harder without them.
    headers: { 'HTTP-Referer': 'https://gymflow.ng', 'X-Title': 'GymFlow' },
  },

  azure_openai: {
    dialect: 'unsupported',
    auth: 'none',
    unsupportedReason:
      'Azure needs a per-deployment endpoint URL and api-version, not just a key. Use OpenAI directly, or ask GymFlow to enable an Azure deployment for you.',
  },
  bedrock: {
    dialect: 'unsupported',
    auth: 'none',
    unsupportedReason:
      'AWS Bedrock signs every request with SigV4 credentials rather than a bearer key. Use Anthropic directly for the same models.',
  },
  vertex: {
    dialect: 'unsupported',
    auth: 'none',
    unsupportedReason:
      'Vertex AI authenticates with a Google service account, not an API key. Use the Google Gemini provider for the same models.',
  },
};

export function dialectFor(slug: string): DialectSpec {
  return DIALECTS[slug] ?? OPENAI_COMPATIBLE;
}

export function providerUsable(slug: string): boolean {
  return dialectFor(slug).dialect !== 'unsupported';
}
