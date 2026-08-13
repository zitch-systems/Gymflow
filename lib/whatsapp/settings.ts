import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { dialLink } from '@/lib/whatsapp/phone';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

export type WhatsAppGym = {
  id: string;
  name: string;
  slug: string;
  member_code: string;
  status: string | null;
  phone: string | null;
  subscription_plan?: string | null;
  paystack_subaccount_code?: string | null;
};

export type WhatsAppGymSettings = {
  gymId: string;
  enabled: boolean;
  /** The number a member is told to call for THIS gym. Never the platform's. */
  supportPhone: string | null;
  appHomeUrl: string;
  welcomeMessage: string | null;
  aiEnabled: boolean;
  qrCheckinEnabled: boolean;
};

export const GYM_COLUMNS =
  'id, name, slug, member_code, status, phone, subscription_plan, paystack_subaccount_code';

/**
 * The gym's home on the web — its own branded subdomain, which is also what the
 * native app opens. Members get this link in the menu so WhatsApp is a door
 * into the app rather than a walled-off copy of it.
 */
export function gymHomeUrl(gym: Pick<WhatsAppGym, 'slug'>): string {
  return `https://${gym.slug}.${ROOT_DOMAIN}`;
}

/**
 * Resolve a gym's WhatsApp configuration, filling every gap with a sane
 * default. The row is optional by design: a gym that has never opened the
 * WhatsApp tab is still fully served — enabled, with its own phone number as
 * the support line and its subdomain as the app link. Nothing about this
 * channel should require a gym to configure it first.
 *
 * The AI is the one exception and defaults OFF, because an assistant nobody has
 * reviewed the prompt for should not be answering a stranger's questions about
 * a business.
 */
export async function loadGymWhatsAppSettings(admin: Admin, gym: WhatsAppGym): Promise<WhatsAppGymSettings> {
  const { data } = await admin
    .from('gym_whatsapp_settings')
    .select('enabled, support_phone, app_home_url, welcome_message, ai_enabled, qr_checkin_enabled')
    .eq('gym_id', gym.id)
    .maybeSingle();

  const row = data as {
    enabled: boolean; support_phone: string | null; app_home_url: string | null;
    welcome_message: string | null; ai_enabled: boolean; qr_checkin_enabled: boolean;
  } | null;

  return {
    gymId: gym.id,
    enabled: row?.enabled ?? true,
    // Explicit override first, then the gym's own listed phone. Falling back to
    // gyms.phone is what makes "the customer service number is the gym's
    // number" true on day one rather than after someone fills in a form.
    supportPhone: dialLink(row?.support_phone ?? null) ?? dialLink(gym.phone),
    appHomeUrl: (row?.app_home_url ?? '').trim() || gymHomeUrl(gym),
    welcomeMessage: row?.welcome_message ?? null,
    aiEnabled: row?.ai_enabled ?? false,
    qrCheckinEnabled: row?.qr_checkin_enabled ?? true,
  };
}

/** Look a gym up by its member code, honouring the platform off-switch. */
export async function gymByMemberCode(admin: Admin, code: string): Promise<WhatsAppGym | null> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!normalized) return null;
  const { data } = await admin
    .from('gyms').select(GYM_COLUMNS)
    .eq('member_code', normalized)
    .not('status', 'in', '("suspended","terminated")')
    .maybeSingle();
  return (data as WhatsAppGym | null) ?? null;
}

/** Look a gym up by slug — used by the door-QR deep link. */
export async function gymBySlug(admin: Admin, slug: string): Promise<WhatsAppGym | null> {
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,64}$/.test(clean)) return null;
  const { data } = await admin
    .from('gyms').select(GYM_COLUMNS)
    .eq('slug', clean)
    .not('status', 'in', '("suspended","terminated")')
    .maybeSingle();
  return (data as WhatsAppGym | null) ?? null;
}

export async function gymById(admin: Admin, id: string): Promise<WhatsAppGym | null> {
  const { data } = await admin.from('gyms').select(GYM_COLUMNS).eq('id', id).maybeSingle();
  return (data as WhatsAppGym | null) ?? null;
}
