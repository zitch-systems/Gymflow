import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { secretsConfigured } from '@/lib/crypto/secret-box';
import { AiConsole, type ProviderCard } from './ai-client';

export const metadata = { title: 'AI providers' };

/**
 * The platform's model-vendor catalogue.
 *
 * Every one of the 22 seeded providers ships DISABLED and keyless (see the
 * seed at the bottom of 20260813090000_whatsapp_channel_and_ai.sql), and
 * resolveAi() refuses a provider that isn't enabled with a usable key. Until
 * this page existed there was no way to change either, so a gym owner could
 * pick a provider in their WhatsApp tab and never get a reply — the assistant
 * was unreachable platform-wide by construction.
 */
export default async function SuperAi() {
  await requirePlatformAdmin();

  // Service-role: api_key_encrypted is withheld from `authenticated` by a
  // column-level grant, and this page needs to know whether a key exists (never
  // what it is — the boolean below is all that leaves the server).
  const db = createAdminClient();
  const [{ data: providerRows }, { data: gymAi }] = await Promise.all([
    db.from('ai_providers')
      .select('slug, name, base_url, default_model, models, enabled, docs_url, api_key_encrypted, updated_at')
      .order('sort_order', { ascending: true }),
    db.from('gym_ai_settings').select('gym_id, provider_slug, enabled'),
  ]);

  type Row = {
    slug: string; name: string; base_url: string | null; default_model: string | null;
    models: string[] | null; enabled: boolean; docs_url: string | null;
    api_key_encrypted: string | null; updated_at: string | null;
  };

  // How many gyms have picked each provider, so disabling one shows its blast
  // radius rather than quietly breaking somebody's assistant.
  const uses = new Map<string, { total: number; live: number }>();
  for (const g of ((gymAi ?? []) as { provider_slug: string | null; enabled: boolean }[])) {
    if (!g.provider_slug) continue;
    const u = uses.get(g.provider_slug) ?? { total: 0, live: 0 };
    u.total += 1;
    if (g.enabled) u.live += 1;
    uses.set(g.provider_slug, u);
  }

  const providers: ProviderCard[] = ((providerRows ?? []) as unknown as Row[]).map((p) => ({
    slug: p.slug,
    name: p.name,
    baseUrl: p.base_url,
    defaultModel: p.default_model,
    models: p.models ?? [],
    enabled: p.enabled,
    docsUrl: p.docs_url,
    hasKey: Boolean(p.api_key_encrypted),
    updatedAt: p.updated_at,
    gymsUsing: uses.get(p.slug)?.total ?? 0,
    gymsLive: uses.get(p.slug)?.live ?? 0,
  }));

  return <AiConsole providers={providers} secretsReady={secretsConfigured()} />;
}
