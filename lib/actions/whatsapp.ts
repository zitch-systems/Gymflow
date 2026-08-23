'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { gymCanUse, upgradeMessage } from '@/lib/entitlements';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { encryptSecret, secretsConfigured } from '@/lib/crypto/secret-box';
import { providerUsable } from '@/lib/ai/dialects';
import { sendStaffReply } from '@/lib/whatsapp/notify';
import type { Database } from '@/lib/database.types';

export type WhatsAppSaveState = { ok: boolean; error: string | null };

// The WhatsApp console page renders a FeatureLockWall for gyms below Growth,
// but a wall in a page does not run for a Server Action POST — so every action
// in this file was reachable by a Starter gym posting the action id directly,
// which would enable the channel and send real WhatsApp messages on the
// platform's number. Each write gates on the same feature the wall checks.
// gymCanUse (not gymHasFeature) so grandfathered gyms keep what they had —
// see the asymmetry documented in lib/entitlements.ts.
function whatsappLocked(gym: Parameters<typeof gymCanUse>[0]): string | null {
  return gymCanUse(gym, 'whatsapp_reminders') ? null : upgradeMessage('whatsapp_reminders');
}

// The assistant is its own Growth feature, gated separately from the channel.
function aiLocked(gym: Parameters<typeof gymCanUse>[0]): string | null {
  return gymCanUse(gym, 'ai_assistant') ? null : upgradeMessage('ai_assistant');
}

// ── Channel settings ────────────────────────────────────────────────────────
// gym_whatsapp_settings.ai_enabled is deliberately left untouched here — it's
// the assistant's own on/off switch (Settings tab is channel plumbing, the AI
// tab below owns the assistant). Upserting only the columns this form actually
// edits means saving one never quietly flips the other.
export async function saveWhatsAppSettings(_prev: WhatsAppSaveState, formData: FormData): Promise<WhatsAppSaveState> {
  const enabled = formData.get('enabled') === 'on';
  const qr_checkin_enabled = formData.get('qr_checkin_enabled') === 'on';
  const support_phone = String(formData.get('support_phone') ?? '').trim() || null;
  const app_home_url = String(formData.get('app_home_url') ?? '').trim() || null;
  const welcome_message = String(formData.get('welcome_message') ?? '').trim() || null;
  if (app_home_url && !/^https?:\/\//i.test(app_home_url)) {
    return { ok: false, error: 'Home link must start with http:// or https://.' };
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const locked = whatsappLocked(gym);
    if (locked) return { ok: false, error: locked };
    const supabase = await createClient();
    const patch: Database['public']['Tables']['gym_whatsapp_settings']['Insert'] = {
      gym_id: gym.id, enabled, support_phone, app_home_url, welcome_message, qr_checkin_enabled,
    };
    const { error } = await supabase.from('gym_whatsapp_settings').upsert(patch, { onConflict: 'gym_id' });
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'whatsapp_settings_updated', table: 'gym_whatsapp_settings', actorId: user.id, gymId: gym.id, recordId: gym.id, values: patch });
    try { revalidatePath('/admin/whatsapp'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Staff replies ────────────────────────────────────────────────────────────
// A member's WhatsApp identity has no gym-scoped foreign key of its own
// (whatsapp_contacts is keyed on wa_id platform-wide), so re-checking
// active_gym_id here — on top of the RLS select policy that already scopes the
// read — is what stops a stale or forged contact_id from another gym reaching
// sendStaffReply at all.
export async function replyToContact(_prev: WhatsAppSaveState, formData: FormData): Promise<WhatsAppSaveState> {
  const contactId = String(formData.get('contact_id') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!contactId) return { ok: false, error: 'Pick a conversation first.' };
  if (!body) return { ok: false, error: 'Write a message first.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const locked = whatsappLocked(gym);
    if (locked) return { ok: false, error: locked };
    const supabase = await createClient();
    const { data: contact } = await supabase
      .from('whatsapp_contacts')
      .select('id, active_gym_id')
      .eq('id', contactId)
      .maybeSingle();
    if (!contact || contact.active_gym_id !== gym.id) {
      return { ok: false, error: 'That conversation isn’t part of this gym.' };
    }
    // whatsapp_messages carries no authenticated INSERT grant — every write is
    // either a webhook or, here, a staff send — so the actual send + log runs
    // through the service-role client inside sendStaffReply.
    const admin = createAdminClient();
    const res = await sendStaffReply(admin, { contactId, gymId: gym.id, body });
    if (!res.ok) return { ok: false, error: res.error ?? 'Could not send that message.' };
    logAudit({ action: 'whatsapp_staff_reply_sent', table: 'whatsapp_messages', actorId: user.id, gymId: gym.id, recordId: contactId });
    try { revalidatePath('/admin/whatsapp'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type WhatsAppMessageRow = {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  authored_by: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
};

/**
 * The last 50 messages with one contact, oldest first for a natural transcript
 * read. Not a form action — the client calls this directly (from the "View
 * chat" button) rather than through useActionState, since it only reads.
 */
export async function loadContactMessages(contactId: string): Promise<{ ok: boolean; error: string | null; messages: WhatsAppMessageRow[] }> {
  const id = String(contactId ?? '').trim();
  if (!id) return { ok: false, error: 'Missing conversation.', messages: [] };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const locked = whatsappLocked(gym);
    if (locked) return { ok: false, error: locked, messages: [] };
    const supabase = await createClient();
    const { data: contact } = await supabase
      .from('whatsapp_contacts')
      .select('id, active_gym_id')
      .eq('id', id)
      .maybeSingle();
    if (!contact || contact.active_gym_id !== gym.id) {
      return { ok: false, error: 'That conversation isn’t part of this gym.', messages: [] };
    }
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, kind, body, authored_by, status, error, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return { ok: false, error: error.message, messages: [] };
    return { ok: true, error: null, messages: (data ?? []).slice().reverse() };
  } catch (e) {
    return { ok: false, error: (e as Error).message, messages: [] };
  }
}

// ── AI assistant settings ────────────────────────────────────────────────────
// The whole save goes through the service-role client, not just the key
// column: gym_ai_settings.api_key_encrypted is meant to be unreadable to an
// authenticated session (see the migration's column-scoped SELECT grant), and
// splitting one upsert into "most columns via the user client, key via admin"
// would be two round-trips racing each other for no real gain.
export async function saveAiSettings(_prev: WhatsAppSaveState, formData: FormData): Promise<WhatsAppSaveState> {
  const enabled = formData.get('enabled') === 'on';
  const providerSlug = String(formData.get('provider_slug') ?? '').trim() || null;
  // The model field is a <select> of the provider's known ids plus a free-text
  // override for anything newer than our catalogue — the override wins when set.
  const modelCustom = String(formData.get('model_custom') ?? '').trim();
  const modelSelect = String(formData.get('model') ?? '').trim();
  const model = modelCustom || modelSelect || null;
  const systemPrompt = String(formData.get('system_prompt') ?? '').trim() || null;
  const apiKey = String(formData.get('api_key') ?? '');

  if (providerSlug && !providerUsable(providerSlug)) {
    return { ok: false, error: 'That provider needs platform-side configuration before a gym can use it — pick another.' };
  }

  const temperature = Number(formData.get('temperature'));
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return { ok: false, error: 'Temperature must be between 0 and 2.' };
  }
  const maxTokens = Math.trunc(Number(formData.get('max_tokens')));
  if (!Number.isFinite(maxTokens) || maxTokens < 100 || maxTokens > 4000) {
    return { ok: false, error: 'Max tokens must be between 100 and 4000.' };
  }
  const monthlyCap = Math.trunc(Number(formData.get('monthly_token_cap')));
  if (!Number.isFinite(monthlyCap) || monthlyCap < 0) {
    return { ok: false, error: 'Monthly token cap must be zero or more.' };
  }

  if (apiKey && !secretsConfigured()) {
    return { ok: false, error: 'Set SECRETS_ENCRYPTION_KEY on the server before storing provider keys.' };
  }

  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const locked = aiLocked(gym);
    if (locked) return { ok: false, error: locked };
    const admin = createAdminClient();
    const patch: Database['public']['Tables']['gym_ai_settings']['Insert'] = {
      gym_id: gym.id,
      enabled,
      provider_slug: providerSlug,
      model,
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
      monthly_token_cap: monthlyCap,
    };
    // An empty key field means "leave whatever's stored alone" — the separate
    // Remove key button is the only way to clear it, so a blank submit can
    // never accidentally knock a working key back to the platform default.
    if (apiKey) patch.api_key_encrypted = encryptSecret(apiKey);
    const { error } = await admin.from('gym_ai_settings').upsert(patch, { onConflict: 'gym_id' });
    if (error) return { ok: false, error: error.message };
    logAudit({
      action: 'ai_settings_updated', table: 'gym_ai_settings', actorId: user.id, gymId: gym.id, recordId: gym.id,
      // Never the key itself in the audit trail — only whether this save touched it.
      values: { ...patch, api_key_encrypted: apiKey ? '[updated]' : undefined },
    });
    try { revalidatePath('/admin/whatsapp'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Nulls the stored key so the assistant falls back to the platform's own
// ai_providers key for this provider. Separate action (rather than folding
// into saveAiSettings) so it can't be triggered by an empty field on a form
// submit meant to change something else entirely.
export async function clearAiKey(_prev: WhatsAppSaveState, _formData: FormData): Promise<WhatsAppSaveState> {
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const admin = createAdminClient();
    const { error } = await admin.from('gym_ai_settings').update({ api_key_encrypted: null }).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'ai_key_removed', table: 'gym_ai_settings', actorId: user.id, gymId: gym.id, recordId: gym.id });
    try { revalidatePath('/admin/whatsapp'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Whether a gym-supplied key is on file — never the key itself. The SELECT
 * grant on gym_ai_settings withholds api_key_encrypted from authenticated
 * sessions entirely, so this is the only way the server page can tell the UI
 * "a key is installed" without the admin client living inside the page itself.
 * Same shape as cacCertificateUrl in lib/actions/gym.ts: a read-only helper
 * exported from a 'use server' file and called directly from a Server
 * Component, not through useActionState.
 */
export async function hasGymAiKey(): Promise<boolean> {
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const admin = createAdminClient();
    const { data } = await admin.from('gym_ai_settings').select('api_key_encrypted').eq('gym_id', gym.id).maybeSingle();
    return Boolean((data as { api_key_encrypted: string | null } | null)?.api_key_encrypted);
  } catch {
    return false;
  }
}
