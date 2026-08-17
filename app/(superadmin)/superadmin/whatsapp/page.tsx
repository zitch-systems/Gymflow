import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { secretsConfigured } from '@/lib/crypto/secret-box';
import { WhatsAppConsole, type GymChannelRow } from './whatsapp-client';

export const metadata = { title: 'WhatsApp channel' };

// The channel's server-side dependencies. Same booleans the gym-facing tab
// shows (app/(admin)/admin/whatsapp/page.tsx), except here they are the whole
// platform's status — one Meta number fronts every tenant, so a missing token
// is not one gym's problem, it is everyone's.
function envStatus() {
  return {
    WHATSAPP_ACCESS_TOKEN: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    META_APP_SECRET: Boolean(process.env.META_APP_SECRET),
    WHATSAPP_FLOW_ID: Boolean(process.env.WHATSAPP_FLOW_ID),
    WHATSAPP_FLOW_PRIVATE_KEY: Boolean(process.env.WHATSAPP_FLOW_PRIVATE_KEY),
    // secretsConfigured() also checks the value decodes to 32 bytes rather than
    // merely being present — a stricter, more honest check than Boolean().
    SECRETS_ENCRYPTION_KEY: secretsConfigured(),
  };
}

export default async function SuperWhatsApp() {
  await requirePlatformAdmin();

  // Service-role throughout: every query here is deliberately cross-tenant, and
  // the RLS-scoped client would return one gym's worth of rows (or none, since
  // a platform admin is not staff at any gym).
  const db = createAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [
    { data: gymRows },
    { data: settingRows },
    { data: contactRows },
    { data: messageRows },
    { data: intentRows },
    { count: totalMessages },
  ] = await Promise.all([
    db.from('gyms').select('id, name, slug, status, phone').not('status', 'in', '("terminated")').order('name', { ascending: true }),
    db.from('gym_whatsapp_settings').select('gym_id, enabled, ai_enabled, qr_checkin_enabled, support_phone'),
    db.from('whatsapp_contacts').select('active_gym_id, profile_id'),
    db.from('whatsapp_messages').select('gym_id, direction').gte('created_at', since),
    db.from('whatsapp_payment_intents').select('gym_id').eq('status', 'pending'),
    db.from('whatsapp_messages').select('id', { count: 'exact', head: true }),
  ]);

  type Gym = { id: string; name: string; slug: string; status: string | null; phone: string | null };
  type Setting = { gym_id: string; enabled: boolean; ai_enabled: boolean; qr_checkin_enabled: boolean; support_phone: string | null };

  const settings = new Map<string, Setting>();
  for (const s of ((settingRows ?? []) as Setting[])) settings.set(s.gym_id, s);

  // Counts are tallied here rather than with one grouped query per metric:
  // PostgREST has no GROUP BY, and six round-trips of counts per gym is worse
  // than three list reads folded in memory at this scale.
  const contacts = new Map<string, { total: number; linked: number }>();
  for (const c of ((contactRows ?? []) as { active_gym_id: string | null; profile_id: string | null }[])) {
    if (!c.active_gym_id) continue;
    const e = contacts.get(c.active_gym_id) ?? { total: 0, linked: 0 };
    e.total += 1;
    if (c.profile_id) e.linked += 1;
    contacts.set(c.active_gym_id, e);
  }

  const msgs = new Map<string, number>();
  let inbound7d = 0;
  for (const m of ((messageRows ?? []) as { gym_id: string | null; direction: string }[])) {
    if (m.direction === 'inbound') inbound7d += 1;
    if (!m.gym_id) continue;
    msgs.set(m.gym_id, (msgs.get(m.gym_id) ?? 0) + 1);
  }

  const intents = new Map<string, number>();
  for (const i of ((intentRows ?? []) as { gym_id: string | null }[])) {
    if (!i.gym_id) continue;
    intents.set(i.gym_id, (intents.get(i.gym_id) ?? 0) + 1);
  }

  const gyms: GymChannelRow[] = ((gymRows ?? []) as Gym[]).map((g) => {
    const s = settings.get(g.id);
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      status: g.status,
      // No row means the gym has never opened its WhatsApp tab. It is still
      // fully served on the defaults in lib/whatsapp/settings.ts — enabled,
      // assistant off — so the page must show those, not blanks.
      configured: Boolean(s),
      enabled: s?.enabled ?? true,
      aiEnabled: s?.ai_enabled ?? false,
      qrCheckinEnabled: s?.qr_checkin_enabled ?? true,
      supportPhone: s?.support_phone ?? g.phone,
      contacts: contacts.get(g.id)?.total ?? 0,
      linkedContacts: contacts.get(g.id)?.linked ?? 0,
      messages7d: msgs.get(g.id) ?? 0,
      pendingIntents: intents.get(g.id) ?? 0,
    };
  });

  return (
    <WhatsAppConsole
      gyms={gyms}
      env={envStatus()}
      businessNumber={process.env.WHATSAPP_BUSINESS_NUMBER ?? null}
      totals={{ messagesAllTime: totalMessages ?? 0, inbound7d }}
    />
  );
}
