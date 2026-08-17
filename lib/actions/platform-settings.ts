'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { encryptSecret, secretsConfigured } from '@/lib/crypto/secret-box';
import { providerUsable } from '@/lib/ai/dialects';
import { SUPERADMIN_ROUTE } from '@/lib/superadmin-path';
import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type LooseDb = SupabaseClient<any, any, any>;

// Platform-level configuration the console can change: the defaults new gyms
// start on, and the AI provider catalogue every gym chooses from.
//
// Every action here is a cross-tenant write, so they share one front door —
// requirePlatformAdmin() then the service-role client — the same shape
// lib/actions/platform-gym.ts uses.

export type SettingsState = { ok: boolean; error: string | null; message?: string };

const OK = (message: string): SettingsState => ({ ok: true, error: null, message });
const FAIL = (error: string): SettingsState => ({ ok: false, error });

// Revalidate the INTERNAL route paths. The console may be served from a secret
// segment (lib/superadmin-path.ts), but the rendered route underneath is always
// this one, and that is what Next has cached.
function revalidateConsole(...subpaths: string[]) {
  for (const sub of subpaths) revalidatePath(`${SUPERADMIN_ROUTE}${sub}`);
}

/**
 * The commission and trial length a newly provisioned gym starts on.
 *
 * Deliberately does NOT touch existing gyms. Each one carries its own
 * gyms.platform_commission_pct, copied from here at provision time and editable
 * per gym — re-pricing live tenants as a side effect of changing a default is
 * the kind of thing that should never be one form submit away.
 */
export async function setPlatformDefaults(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requirePlatformAdmin();

  const pct = Number(formData.get('default_commission_pct'));
  const days = Number(formData.get('default_trial_days'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return FAIL('Commission must be between 0 and 100%.');
  if (!Number.isFinite(days) || days < 0 || days > 365 || !Number.isInteger(days)) {
    return FAIL('Trial length must be a whole number of days, 0–365.');
  }

  // platform_settings postdates lib/database.types.ts (which is checked in, not
  // generated at build time), so the client is widened here the same way
  // lib/platform-settings.ts widens it for the read side.
  const db = createAdminClient() as unknown as LooseDb;
  const { error } = await db.from('platform_settings')
    .update({
      default_commission_pct: pct,
      default_trial_days: days,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq('id', true);
  if (error) return FAIL(error.message);

  logAudit({
    action: 'platform_defaults_updated', table: 'platform_settings',
    actorId: admin.id, values: { default_commission_pct: pct, default_trial_days: days },
  });
  revalidateConsole('/settings');
  return OK('Defaults saved. Existing gyms keep their own rate.');
}

// ── AI provider catalogue ──────────────────────────────────────────────────
//
// 22 providers ship seeded and every one of them is disabled, which is why the
// assistant could never start for any gym: a gym owner picks a provider in
// their WhatsApp tab, and resolveAi() refuses anything that isn't enabled with
// a usable key. These actions are the only way to change that, and until now
// the console had no page for them at all.

/** Turn a provider on or off for every gym at once. */
export async function setProviderEnabled(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requirePlatformAdmin();
  const slug = String(formData.get('slug') ?? '').trim();
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (!slug) return FAIL('Missing provider.');

  // A provider whose vendor needs more than an API key (Azure, Bedrock, Vertex)
  // can be listed but never made usable — enabling it would only produce a
  // provider a gym can select and never get a reply from.
  if (enabled && !providerUsable(slug)) {
    return FAIL('This provider needs credentials GymFlow can’t hold yet (see the note on its row), so it can’t be enabled.');
  }

  const db = createAdminClient();
  const { error } = await db.from('ai_providers')
    .update({ enabled, updated_at: new Date().toISOString() } as never)
    .eq('slug', slug);
  if (error) return FAIL(error.message);

  logAudit({ action: enabled ? 'ai_provider_enabled' : 'ai_provider_disabled', table: 'ai_providers', actorId: admin.id, values: { slug } });
  revalidateConsole('/ai');
  return OK(enabled ? `${slug} enabled.` : `${slug} disabled.`);
}

/**
 * Set the platform's own key for a provider, and its default model.
 *
 * The key is encrypted at rest with the same AES-256-GCM box the gyms' own keys
 * use, and is never read back to any browser — the page shows only whether one
 * is present. An empty key field means "leave the stored key alone"; clearing
 * one is its own explicit action below, so a save that only changes the model
 * can't wipe the credential by omission.
 */
export async function setProviderConfig(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requirePlatformAdmin();
  const slug = String(formData.get('slug') ?? '').trim();
  if (!slug) return FAIL('Missing provider.');

  const model = String(formData.get('default_model') ?? '').trim().slice(0, 120);
  const baseUrl = String(formData.get('base_url') ?? '').trim().slice(0, 300);
  const apiKey = String(formData.get('api_key') ?? '').trim();

  const patch: Record<string, unknown> = {
    default_model: model || null,
    base_url: baseUrl || null,
    updated_at: new Date().toISOString(),
  };

  if (apiKey) {
    if (!secretsConfigured()) {
      return FAIL('Secret encryption isn’t configured on this deployment (SECRET_BOX_KEY), so a key can’t be stored safely.');
    }
    patch.api_key_encrypted = encryptSecret(apiKey);
  }

  const db = createAdminClient();
  const { error } = await db.from('ai_providers').update(patch as never).eq('slug', slug);
  if (error) return FAIL(error.message);

  // The key itself never enters the audit log — only the fact that it changed.
  logAudit({
    action: 'ai_provider_configured', table: 'ai_providers', actorId: admin.id,
    values: { slug, default_model: model || null, base_url: baseUrl || null, key_changed: Boolean(apiKey) },
  });
  revalidateConsole('/ai');
  return OK(apiKey ? 'Saved, including a new key.' : 'Saved.');
}

/** Remove the platform key for a provider, leaving gyms to supply their own. */
export async function clearProviderKey(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requirePlatformAdmin();
  const slug = String(formData.get('slug') ?? '').trim();
  if (!slug) return FAIL('Missing provider.');

  const db = createAdminClient();
  const { error } = await db.from('ai_providers')
    .update({ api_key_encrypted: null, updated_at: new Date().toISOString() } as never)
    .eq('slug', slug);
  if (error) return FAIL(error.message);

  logAudit({ action: 'ai_provider_key_cleared', table: 'ai_providers', actorId: admin.id, values: { slug } });
  revalidateConsole('/ai');
  return OK('Platform key removed. Gyms using it will need their own.');
}
