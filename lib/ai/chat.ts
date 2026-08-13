import 'server-only';
import { dialectFor } from './dialects';
import type { ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolSpec } from './types';

// One `chat()` for every vendor.
//
// The three request shapes are handled inline rather than behind a plugin
// interface: there are exactly three, they are stable, and a registry of
// single-implementation classes would be more code and less readable than the
// switch below.
//
// Timeouts are short (20s). This runs inside a WhatsApp webhook — Meta retries
// a delivery we do not answer quickly, and a member watching a chat thread will
// give up long before a slow model does.

const TIMEOUT_MS = 20_000;

export async function chat(
  params: ChatRequest & { slug: string; baseUrl: string | null; apiKey: string | null },
): Promise<ChatResponse> {
  const spec = dialectFor(params.slug);
  if (spec.dialect === 'unsupported') {
    return { ok: false, error: spec.unsupportedReason ?? 'This provider is not supported.', retryable: false };
  }
  if (spec.auth !== 'none' && !params.apiKey) {
    return { ok: false, error: 'No API key is configured for this provider.', retryable: false };
  }
  if (!params.baseUrl) {
    return { ok: false, error: 'No base URL is configured for this provider.', retryable: false };
  }

  try {
    switch (spec.dialect) {
      case 'anthropic': return await anthropicChat(params);
      case 'google': return await googleChat(params);
      default: return await openaiChat(params);
    }
  } catch (e) {
    const err = e as Error;
    // AbortError is a timeout — worth another go on a later message, unlike a
    // 400 from a malformed model name.
    const retryable = err.name === 'AbortError' || err.name === 'TypeError';
    return { ok: false, error: `${err.name}: ${err.message}`, retryable };
  }
}

function signal(): AbortSignal | undefined {
  return AbortSignal.timeout?.(TIMEOUT_MS);
}

/** 5xx and 429 are worth retrying later; 4xx is a configuration mistake. */
function httpError(status: number, body: string): ChatResponse {
  return {
    ok: false,
    error: `Provider returned ${status}: ${body.slice(0, 300)}`,
    retryable: status === 429 || status >= 500,
  };
}

// ── OpenAI-compatible ──────────────────────────────────────────────────────

async function openaiChat(
  params: ChatRequest & { slug: string; baseUrl: string | null; apiKey: string | null },
): Promise<ChatResponse> {
  const spec = dialectFor(params.slug);
  const messages: Record<string, unknown>[] = [];
  if (params.system) messages.push({ role: 'system', content: params.system });

  for (const m of params.messages) {
    if (m.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.arguments) },
        })),
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const res = await fetch(`${params.baseUrl!.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(spec.auth === 'bearer' && params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      ...(spec.headers ?? {}),
    },
    body: JSON.stringify({
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 600,
      ...(params.tools?.length
        ? {
            tools: params.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
    }),
    cache: 'no-store',
    signal: signal(),
  });

  if (!res.ok) return httpError(res.status, await res.text().catch(() => ''));

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const message = json.choices?.[0]?.message;
  return {
    ok: true,
    text: message?.content ?? '',
    toolCalls: (message?.tool_calls ?? []).map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.function?.name ?? '',
      arguments: safeParse(c.function?.arguments),
    })).filter((c) => c.name),
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

// ── Anthropic Messages ─────────────────────────────────────────────────────

async function anthropicChat(
  params: ChatRequest & { baseUrl: string | null; apiKey: string | null },
): Promise<ChatResponse> {
  const spec = dialectFor('anthropic');

  // Anthropic takes the system prompt as a top-level field, and expresses tool
  // results as user-turn content blocks rather than a distinct role.
  const messages: Record<string, unknown>[] = [];
  for (const m of params.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.arguments })),
        ],
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const res = await fetch(`${params.baseUrl!.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey ?? '',
      ...(spec.headers ?? {}),
    },
    body: JSON.stringify({
      model: params.model,
      // Required by Anthropic, unlike the OpenAI dialect where it is optional.
      max_tokens: params.maxTokens ?? 600,
      temperature: params.temperature ?? 0.3,
      ...(params.system ? { system: params.system } : {}),
      messages,
      ...(params.tools?.length
        ? { tools: params.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
        : {}),
    }),
    cache: 'no-store',
    signal: signal(),
  });

  if (!res.ok) return httpError(res.status, await res.text().catch(() => ''));

  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const blocks = json.content ?? [];
  return {
    ok: true,
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim(),
    toolCalls: blocks
      .filter((b) => b.type === 'tool_use' && b.name)
      .map((b, i) => ({ id: b.id ?? `call_${i}`, name: b.name!, arguments: b.input ?? {} })),
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

// ── Google Gemini ──────────────────────────────────────────────────────────

async function googleChat(
  params: ChatRequest & { baseUrl: string | null; apiKey: string | null },
): Promise<ChatResponse> {
  // Gemini calls the assistant 'model', and carries the key in the query string.
  const contents: Record<string, unknown>[] = [];
  for (const m of params.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.toolCallId ?? 'tool', response: { result: m.content } } }],
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      contents.push({
        role: 'model',
        parts: m.toolCalls.map((t) => ({ functionCall: { name: t.name, args: t.arguments } })),
      });
    } else {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }

  const url = `${params.baseUrl!.replace(/\/+$/, '')}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey ?? '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(params.system ? { systemInstruction: { parts: [{ text: params.system }] } } : {}),
      generationConfig: {
        temperature: params.temperature ?? 0.3,
        maxOutputTokens: params.maxTokens ?? 600,
      },
      ...(params.tools?.length
        ? {
            tools: [{
              functionDeclarations: params.tools.map((t) => ({
                name: t.name, description: t.description, parameters: t.parameters,
              })),
            }],
          }
        : {}),
    }),
    cache: 'no-store',
    signal: signal(),
  });

  if (!res.ok) return httpError(res.status, await res.text().catch(() => ''));

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> };
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    ok: true,
    text: parts.map((p) => p.text ?? '').join('').trim(),
    toolCalls: parts
      .filter((p) => p.functionCall?.name)
      // Gemini has no call id, so the tool name doubles as one — it is what
      // functionResponse matches on.
      .map((p) => ({ id: p.functionCall!.name!, name: p.functionCall!.name!, arguments: p.functionCall!.args ?? {} })),
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

function safeParse(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A model that emits malformed tool arguments should degrade to "no
    // arguments" rather than crash the reply.
    return {};
  }
}

export type { ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolSpec };
