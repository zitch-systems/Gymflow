import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from '@/lib/crypto/secret-box';
import { providerUsable } from './dialects';
import type { GymAiSettings, ProviderRow } from './types';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

export type ResolvedAi = {
  slug: string;
  providerName: string;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  /** Whose key is paying: the gym's own, or the platform's. */
  keyOwner: 'gym' | 'platform';
};

export type AiUnavailable = { reason: 'disabled' | 'unconfigured' | 'capped' | 'unsupported'; detail: string };

/**
 * Work out whether this gym has a usable assistant right now, and with what.
 *
 * Returns a discriminated result rather than throwing or returning null,
 * because the caller needs to distinguish "the owner switched it off" (say
 * nothing, fall back to the menu) from "the key is wrong" (worth telling the
 * owner about in the admin tab).
 */
export async function resolveAi(admin: Admin, gymId: string): Promise<ResolvedAi | AiUnavailable> {
  const { data: settingsRow } = await admin
    .from('gym_ai_settings')
    .select('gym_id, provider_slug, model, api_key_encrypted, system_prompt, temperature, max_tokens, enabled, handoff_keywords, monthly_token_cap, tokens_used_this_month, usage_period_start')
    .eq('gym_id', gymId)
    .maybeSingle();

  const settings = settingsRow as GymAiSettings | null;
  if (!settings?.enabled) return { reason: 'disabled', detail: 'The assistant is switched off for this gym.' };
  if (!settings.provider_slug) return { reason: 'unconfigured', detail: 'No AI provider has been chosen.' };
  if (!providerUsable(settings.provider_slug)) {
    return { reason: 'unsupported', detail: 'The chosen provider needs credentials GymFlow cannot hold for you yet.' };
  }

  // Spend guard. The counter resets lazily on first use in a new calendar
  // month — a cron job for this would be a scheduled write that usually has
  // nothing to do.
  const periodStart = currentPeriodStart();
  const used = settings.usage_period_start === periodStart ? settings.tokens_used_this_month : 0;
  if (settings.monthly_token_cap > 0 && used >= settings.monthly_token_cap) {
    return { reason: 'capped', detail: 'This month’s AI usage cap has been reached.' };
  }

  const { data: providerRow } = await admin
    .from('ai_providers')
    .select('id, slug, name, base_url, default_model, models, api_key_encrypted, enabled, sort_order, docs_url')
    .eq('slug', settings.provider_slug)
    .maybeSingle();

  const provider = providerRow as (ProviderRow & { api_key_encrypted: string | null }) | null;
  if (!provider) return { reason: 'unconfigured', detail: 'The chosen AI provider is no longer available.' };

  // A gym's own key takes precedence. Falling back to the platform key is what
  // lets GymFlow offer the assistant as a bundled feature, but a gym that pays
  // its own vendor bill must never be silently billed to us instead.
  const gymKey = decryptSecret(settings.api_key_encrypted);
  const platformKey = provider.enabled ? decryptSecret(provider.api_key_encrypted) : null;
  const apiKey = gymKey ?? platformKey;

  if (!apiKey && provider.slug !== 'ollama') {
    return { reason: 'unconfigured', detail: 'No API key is set for the chosen provider.' };
  }

  return {
    slug: provider.slug,
    providerName: provider.name,
    model: settings.model || provider.default_model || '',
    baseUrl: provider.base_url,
    apiKey,
    systemPrompt: settings.system_prompt,
    temperature: Number(settings.temperature ?? 0.3),
    maxTokens: settings.max_tokens ?? 600,
    keyOwner: gymKey ? 'gym' : 'platform',
  };
}

export function isUnavailable(v: ResolvedAi | AiUnavailable): v is AiUnavailable {
  return 'reason' in v;
}

/** First day of the current month, as the usage counter stamps it. */
export function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Add this call's tokens to the month's tally, rolling the period over when the
 * month has changed. Read-modify-write is acceptable here: the counter guards a
 * budget, not a ledger, and a lost update under concurrency costs at most one
 * conversation's worth of tokens.
 */
export async function recordUsage(admin: Admin, gymId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const period = currentPeriodStart();
  const { data } = await admin
    .from('gym_ai_settings')
    .select('tokens_used_this_month, usage_period_start')
    .eq('gym_id', gymId)
    .maybeSingle();
  const row = data as { tokens_used_this_month: number; usage_period_start: string } | null;
  if (!row) return;

  const base = row.usage_period_start === period ? row.tokens_used_this_month : 0;
  await admin
    .from('gym_ai_settings')
    .update({
      tokens_used_this_month: base + tokens,
      usage_period_start: period,
      updated_at: new Date().toISOString(),
    })
    .eq('gym_id', gymId);
}

/** The words that stop the assistant and hand over to a person. */
export async function handoffKeywords(admin: Admin, gymId: string): Promise<string[]> {
  const { data } = await admin
    .from('gym_ai_settings').select('handoff_keywords').eq('gym_id', gymId).maybeSingle();
  return ((data as { handoff_keywords: string[] } | null)?.handoff_keywords ?? []).map((k) => k.toLowerCase());
}
