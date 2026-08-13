// Shared vocabulary for the AI layer.
//
// Kept free of server-only imports so the admin UI can import the provider
// catalogue types without dragging the adapter (and its secrets) into a client
// bundle.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** Set on role:'tool' — which call this result answers. */
  toolCallId?: string;
  /** Set on role:'assistant' when the model asked for tools instead of replying. */
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  system?: string;
  tools?: ToolSpec[];
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse =
  | { ok: true; text: string; toolCalls: ToolCall[]; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; retryable: boolean };

/**
 * How a vendor's HTTP API is shaped. Nearly everyone has settled on OpenAI's
 * /chat/completions, so that is the default and the exceptions are named
 * explicitly rather than each getting a bespoke module.
 */
export type ProviderDialect = 'openai' | 'anthropic' | 'google' | 'unsupported';

export type ProviderRow = {
  id: string;
  slug: string;
  name: string;
  base_url: string | null;
  default_model: string | null;
  models: string[];
  enabled: boolean;
  sort_order: number;
  docs_url: string | null;
  /** Present only on service-role reads. */
  api_key_encrypted?: string | null;
};

export type GymAiSettings = {
  gym_id: string;
  provider_slug: string | null;
  model: string | null;
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  handoff_keywords: string[];
  monthly_token_cap: number;
  tokens_used_this_month: number;
  usage_period_start: string;
  api_key_encrypted?: string | null;
};
