'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { SUPERADMIN_ROUTE } from '@/lib/superadmin-path';

// Platform-side control of the shared WhatsApp number.
//
// One Meta business number fronts every gym, so "is this gym live on WhatsApp"
// is a platform decision as much as a tenant one. The gym owner's own tab
// (/admin/whatsapp) writes the same row for their gym only; these actions reach
// across tenants and are therefore platform-admin gated and service-role.

export type ChannelState = { ok: boolean; error: string | null; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The three per-gym switches this page owns. Anything else stays the gym's. */
const FLAGS = {
  enabled: 'enabled',
  ai_enabled: 'ai_enabled',
  qr_checkin_enabled: 'qr_checkin_enabled',
} as const;

type Flag = keyof typeof FLAGS;

function isFlag(v: string): v is Flag {
  return Object.prototype.hasOwnProperty.call(FLAGS, v);
}

/**
 * Flip one WhatsApp switch for one gym.
 *
 * Upsert rather than update: a gym that has never opened its WhatsApp tab has
 * no gym_whatsapp_settings row at all — it runs entirely on the defaults in
 * lib/whatsapp/settings.ts — so an UPDATE would report success having changed
 * nothing. The insert has to carry the other columns' effective defaults, which
 * are the table defaults, so nothing the gym set is disturbed either way.
 */
export async function setGymChannelFlag(_prev: ChannelState, formData: FormData): Promise<ChannelState> {
  const gymId = String(formData.get('gym_id') ?? '');
  const flag = String(formData.get('flag') ?? '');
  const value = String(formData.get('value') ?? '') === 'true';
  if (!UUID_RE.test(gymId)) return { ok: false, error: 'Missing gym.' };
  if (!isFlag(flag)) return { ok: false, error: 'Unknown setting.' };

  const admin = await requirePlatformAdmin();
  const db = createAdminClient();

  const { data: gym } = await db.from('gyms').select('name').eq('id', gymId).maybeSingle();
  if (!gym) return { ok: false, error: 'That gym no longer exists.' };

  const { error } = await db
    .from('gym_whatsapp_settings')
    .upsert({ gym_id: gymId, [flag]: value, updated_at: new Date().toISOString() } as never, { onConflict: 'gym_id' });
  if (error) return { ok: false, error: error.message };

  logAudit({
    action: 'gym_whatsapp_flag_set', table: 'gym_whatsapp_settings',
    actorId: admin.id, gymId, recordId: gymId, values: { [flag]: value },
  });
  revalidatePath(`${SUPERADMIN_ROUTE}/whatsapp`);
  return { ok: true, error: null, message: `${(gym as { name: string }).name}: ${flag.replace(/_/g, ' ')} ${value ? 'on' : 'off'}.` };
}
