import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { secretsConfigured } from '@/lib/crypto/secret-box';
import { hasGymAiKey } from '@/lib/actions/whatsapp';
import { WhatsAppClient, type ContactRow, type AiProviderRow } from './whatsapp-client';

export const metadata = { title: 'WhatsApp' };

// The channel-health tiles read real env configuration, exactly like the
// paystack/termii/resend badges on /admin/settings — process.env only exists
// server-side, so these booleans are computed here and handed down as props
// rather than the client trying (and failing) to read them itself.
function envStatus() {
  return {
    WHATSAPP_ACCESS_TOKEN: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    META_APP_SECRET: Boolean(process.env.META_APP_SECRET),
    WHATSAPP_FLOW_ID: Boolean(process.env.WHATSAPP_FLOW_ID),
    WHATSAPP_FLOW_PRIVATE_KEY: Boolean(process.env.WHATSAPP_FLOW_PRIVATE_KEY),
    // secretsConfigured() also checks the value actually decodes to 32 bytes,
    // not just that the env var is present — a stricter, more honest check
    // than Boolean() for the one key everything else in this feature depends on.
    SECRETS_ENCRYPTION_KEY: secretsConfigured(),
  };
}

export default async function AdminWhatsApp() {
  const { gym } = await requireStaff(MANAGER_ROLES);
  const supabase = await createClient();

  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalContacts },
    { count: linkedContacts },
    { count: messages7d },
    { count: pendingIntents },
    { data: contactRows },
    { data: waSettingsRow },
    { data: aiSettingsRow },
    { data: providerRows },
  ] = await Promise.all([
    supabase.from('whatsapp_contacts').select('id', { count: 'exact', head: true }).eq('active_gym_id', gym.id),
    supabase.from('whatsapp_contacts').select('id', { count: 'exact', head: true }).eq('active_gym_id', gym.id).not('profile_id', 'is', null),
    supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).gte('created_at', sevenDaysAgoIso),
    supabase.from('whatsapp_payment_intents').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('status', 'pending'),
    // profiles rides along via the whatsapp_contacts_profile_id_fkey embed so
    // the Members tab can show a real name/email without an N+1 fetch.
    supabase.from('whatsapp_contacts')
      .select('id, wa_id, display_name, profile_id, opted_in, blocked, last_inbound_at, last_outbound_at, profiles(full_name, email)')
      .eq('active_gym_id', gym.id)
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from('gym_whatsapp_settings').select('*').eq('gym_id', gym.id).maybeSingle(),
    // api_key_encrypted is intentionally absent — the column-scoped SELECT
    // grant withholds it from authenticated sessions, so listing it here would
    // just error. hasGymAiKey() below is how the page learns whether one exists.
    supabase.from('gym_ai_settings')
      .select('gym_id, provider_slug, model, system_prompt, temperature, max_tokens, enabled, monthly_token_cap, tokens_used_this_month, usage_period_start')
      .eq('gym_id', gym.id)
      .maybeSingle(),
    supabase.from('ai_providers').select('slug, name, models, default_model, docs_url').order('sort_order', { ascending: true }),
  ]);

  const hasGymKey = await hasGymAiKey();

  type RawContact = {
    id: string; wa_id: string; display_name: string | null; profile_id: string | null;
    opted_in: boolean; blocked: boolean; last_inbound_at: string | null; last_outbound_at: string | null;
    profiles: { full_name: string | null; email: string | null } | null;
  };
  const contacts: ContactRow[] = ((contactRows ?? []) as unknown as RawContact[]).map((c) => ({
    id: c.id,
    waId: c.wa_id,
    displayName: c.display_name,
    profileName: c.profiles?.full_name ?? null,
    profileEmail: c.profiles?.email ?? null,
    linked: Boolean(c.profile_id),
    optedIn: c.opted_in,
    blocked: c.blocked,
    lastMessageAt: [c.last_inbound_at, c.last_outbound_at].filter(Boolean).sort().at(-1) ?? null,
  }));

  const wa = waSettingsRow as {
    enabled: boolean; support_phone: string | null; app_home_url: string | null;
    welcome_message: string | null; qr_checkin_enabled: boolean;
  } | null;

  const ai = aiSettingsRow as {
    provider_slug: string | null; model: string | null; system_prompt: string | null;
    temperature: number; max_tokens: number; enabled: boolean;
    monthly_token_cap: number; tokens_used_this_month: number;
  } | null;

  const providers: AiProviderRow[] = ((providerRows ?? []) as unknown as {
    slug: string; name: string; models: string[] | null; default_model: string | null; docs_url: string | null;
  }[]).map((p) => ({
    slug: p.slug, name: p.name, models: p.models ?? [], defaultModel: p.default_model, docsUrl: p.docs_url,
  }));

  return (
    <WhatsAppClient
      gymName={gym.name}
      gymPhone={gym.phone}
      kpis={{
        totalContacts: totalContacts ?? 0,
        linkedContacts: linkedContacts ?? 0,
        messages7d: messages7d ?? 0,
        pendingIntents: pendingIntents ?? 0,
      }}
      env={envStatus()}
      contacts={contacts}
      whatsappSettings={{
        enabled: wa?.enabled ?? true,
        supportPhone: wa?.support_phone ?? null,
        appHomeUrl: wa?.app_home_url ?? null,
        welcomeMessage: wa?.welcome_message ?? null,
        qrCheckinEnabled: wa?.qr_checkin_enabled ?? true,
      }}
      aiSettings={{
        providerSlug: ai?.provider_slug ?? null,
        model: ai?.model ?? null,
        systemPrompt: ai?.system_prompt ?? null,
        temperature: ai?.temperature ?? 0.3,
        maxTokens: ai?.max_tokens ?? 600,
        enabled: ai?.enabled ?? false,
        monthlyTokenCap: ai?.monthly_token_cap ?? 200000,
        tokensUsedThisMonth: ai?.tokens_used_this_month ?? 0,
      }}
      providers={providers}
      hasGymKey={hasGymKey}
      secretsReady={secretsConfigured()}
    />
  );
}
