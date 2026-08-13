-- WhatsApp as a first-class member channel, plus a pluggable AI brain behind it.
--
-- WHAT THIS ADDS
-- Members can already join, check in, see their days and renew — on the web and
-- in the native app. This migration gives them the same account through
-- WhatsApp, on ONE shared business number (+234 916 958 2776, WABA
-- 1517129227120669) that fronts every gym on the platform.
--
-- The identity model is the load-bearing decision here: a WhatsApp signup
-- creates an ORDINARY Supabase auth user with an ordinary password. It is not a
-- parallel credential store. The same email + password therefore signs in on
-- /api/app/signin (native app) and on the web, because there is only ever one
-- account. Nothing in this migration stores a password — Supabase Auth holds
-- the hash, as it does for every other signup path.
--
--   gym_whatsapp_settings   per-gym channel config; notably the customer-service
--                           number members are told to call, which is the GYM's
--                           own line, not the platform's
--   whatsapp_contacts       one row per WhatsApp identity (wa_id), linked to a
--                           profile once they sign in or sign up
--   whatsapp_messages       inbound/outbound log — the gym owner's WhatsApp tab
--                           reads this
--   whatsapp_flow_sessions  short-lived server state for a Meta Flow run
--   whatsapp_email_otps     the six-digit code that proves the mailbox is
--                           theirs, verified inside the Flow before the account
--                           is confirmed
--   whatsapp_payment_intents  a package selection awaiting Paystack
--   ai_providers            platform catalogue of model vendors + keys
--   gym_ai_settings         which vendor/model/prompt a gym's assistant uses
--
-- SECRETS. API keys land in *_encrypted columns as AES-256-GCM ciphertext
-- produced by lib/crypto/secret-box.ts (key: SECRETS_ENCRYPTION_KEY). The
-- database never sees plaintext, so a leaked backup or a mistaken SELECT does
-- not leak a vendor key. RLS additionally keeps the ciphertext away from
-- authenticated clients entirely — only service_role reads those columns.
--
-- Additive + idempotent. Safe to re-run.

-- ── Per-gym WhatsApp configuration ─────────────────────────────────────────
-- One shared sender, many gyms. Everything that must differ per tenant lives
-- here rather than in env: which gyms are live on the channel, what the
-- assistant is allowed to do for them, and — the reason this table exists at
-- all — the support number a member is given when they ask for a human. Sending
-- every gym's members to a single platform hotline would be wrong; they want
-- their own front desk.
create table if not exists public.gym_whatsapp_settings (
  gym_id uuid not null,
  enabled boolean not null default true,
  -- Customer-service number shown to members of THIS gym. Null falls back to
  -- gyms.phone at read time (lib/whatsapp/settings.ts), so a gym that never
  -- opens the settings page still hands out a working number.
  support_phone text,
  -- Overrides the computed https://<slug>.<root> home link in the menu. Set it
  -- to a store listing or a branded deep link when the gym has one.
  app_home_url text,
  welcome_message text,
  -- The assistant answers free text when on. Off = the deterministic numbered
  -- menu only, which is the safe default for a gym that has not looked at it.
  ai_enabled boolean not null default false,
  -- Members may check in by sending the code behind the door QR. Gyms that do
  -- not want remote check-in switch this off and keep the front-desk code path.
  qr_checkin_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='gym_whatsapp_settings_pkey' and conrelid='public.gym_whatsapp_settings'::regclass) then
    alter table public.gym_whatsapp_settings add constraint gym_whatsapp_settings_pkey primary key (gym_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_whatsapp_settings_gym_id_fkey' and conrelid='public.gym_whatsapp_settings'::regclass) then
    alter table public.gym_whatsapp_settings add constraint gym_whatsapp_settings_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete cascade;
  end if;
end $$;

alter table public.gym_whatsapp_settings enable row level security;

drop policy if exists gym_whatsapp_settings_select_staff on public.gym_whatsapp_settings;
create policy gym_whatsapp_settings_select_staff on public.gym_whatsapp_settings
  as permissive for select to authenticated
  using (private.is_gym_staff(gym_id));

drop policy if exists gym_whatsapp_settings_write_owner on public.gym_whatsapp_settings;
create policy gym_whatsapp_settings_write_owner on public.gym_whatsapp_settings
  as permissive for all to authenticated
  using (private.has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]))
  with check (private.has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]));

revoke all on public.gym_whatsapp_settings from anon;
grant select, insert, update, delete on public.gym_whatsapp_settings to authenticated;
grant all on public.gym_whatsapp_settings to service_role;

-- ── WhatsApp contacts ──────────────────────────────────────────────────────
-- A WhatsApp identity is a phone number, and a person has one. So wa_id is
-- unique platform-wide and the row points AT a gym rather than being owned by
-- one — a member who trains at two gyms is one contact who switches context,
-- not two contacts racing to own the same number.
--
-- profile_id stays null until they sign in or sign up through the Flow. An
-- unlinked contact can still be talked to (that is how onboarding starts), but
-- it can see nothing about a membership, because it is not yet proven to be
-- anybody.
create table if not exists public.whatsapp_contacts (
  id uuid not null default gen_random_uuid(),
  -- Digits as Meta sends them, e.g. 2348012345678. Normalised by
  -- lib/whatsapp/phone.ts before any write.
  wa_id text not null,
  profile_id uuid,
  active_gym_id uuid,
  display_name text,
  -- Free-form conversation state for the numbered menu / pending prompts.
  -- Small by construction; anything long-lived belongs in its own table.
  state jsonb not null default '{}'::jsonb,
  -- Meta's 24-hour customer-service window. Outside it only approved templates
  -- may be sent, which is what the reminder path checks before spending a send.
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  -- Marketing consent, separate from the service window. 'stop' sets this
  -- false and only transactional replies continue.
  opted_in boolean not null default true,
  opted_out_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='whatsapp_contacts_pkey' and conrelid='public.whatsapp_contacts'::regclass) then
    alter table public.whatsapp_contacts add constraint whatsapp_contacts_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_contacts_profile_id_fkey' and conrelid='public.whatsapp_contacts'::regclass) then
    alter table public.whatsapp_contacts add constraint whatsapp_contacts_profile_id_fkey
      foreign key (profile_id) references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_contacts_active_gym_id_fkey' and conrelid='public.whatsapp_contacts'::regclass) then
    alter table public.whatsapp_contacts add constraint whatsapp_contacts_active_gym_id_fkey
      foreign key (active_gym_id) references public.gyms(id) on delete set null;
  end if;
end $$;

create unique index if not exists idx_whatsapp_contacts_wa_id on public.whatsapp_contacts (wa_id);
create index if not exists idx_whatsapp_contacts_gym on public.whatsapp_contacts (active_gym_id, last_inbound_at desc);
create index if not exists idx_whatsapp_contacts_profile on public.whatsapp_contacts (profile_id);

alter table public.whatsapp_contacts enable row level security;

-- Staff of the gym the contact is currently attached to may read it; that is
-- what powers the WhatsApp tab. Members read only their own row.
drop policy if exists whatsapp_contacts_select_scoped on public.whatsapp_contacts;
create policy whatsapp_contacts_select_scoped on public.whatsapp_contacts
  as permissive for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (active_gym_id is not null and private.is_gym_staff(active_gym_id))
  );

-- Every write is a consequence of an inbound webhook or a Flow submission, both
-- service-role. An authenticated INSERT would let a signed-in user claim
-- someone else's phone number and inherit their conversation.
revoke insert, update, delete on public.whatsapp_contacts from anon, authenticated;
revoke all on public.whatsapp_contacts from anon;
grant select on public.whatsapp_contacts to authenticated;
grant all on public.whatsapp_contacts to service_role;

-- ── Message log ────────────────────────────────────────────────────────────
-- The gym owner's WhatsApp tab is a support console: it has to show what the
-- member actually said and what the assistant actually replied, or nobody can
-- audit a bad answer. Retention is pruned by the daily cron.
create table if not exists public.whatsapp_messages (
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  gym_id uuid,
  -- Meta's message id, when there is one. Unique per direction so a webhook
  -- redelivery cannot duplicate an inbound row.
  wa_message_id text,
  direction text not null,
  kind text not null default 'text',
  body text,
  -- Full interactive/flow payload for anything that is not plain text.
  payload jsonb,
  -- 'ai' when the assistant composed it, 'menu' for the deterministic replies,
  -- 'system' for reminders and receipts, 'staff' for a human reply.
  authored_by text,
  status text,
  error text,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='whatsapp_messages_pkey' and conrelid='public.whatsapp_messages'::regclass) then
    alter table public.whatsapp_messages add constraint whatsapp_messages_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_messages_contact_id_fkey' and conrelid='public.whatsapp_messages'::regclass) then
    alter table public.whatsapp_messages add constraint whatsapp_messages_contact_id_fkey
      foreign key (contact_id) references public.whatsapp_contacts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_messages_gym_id_fkey' and conrelid='public.whatsapp_messages'::regclass) then
    alter table public.whatsapp_messages add constraint whatsapp_messages_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_messages_direction_check' and conrelid='public.whatsapp_messages'::regclass) then
    alter table public.whatsapp_messages add constraint whatsapp_messages_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;
end $$;

create index if not exists idx_whatsapp_messages_contact on public.whatsapp_messages (contact_id, created_at desc);
create index if not exists idx_whatsapp_messages_gym on public.whatsapp_messages (gym_id, created_at desc);
create unique index if not exists idx_whatsapp_messages_wa_id
  on public.whatsapp_messages (wa_message_id, direction) where (wa_message_id is not null);

alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_messages_select_staff on public.whatsapp_messages;
create policy whatsapp_messages_select_staff on public.whatsapp_messages
  as permissive for select to authenticated
  using (gym_id is not null and private.is_gym_staff(gym_id));

revoke insert, update, delete on public.whatsapp_messages from anon, authenticated;
revoke all on public.whatsapp_messages from anon;
grant select on public.whatsapp_messages to authenticated;
grant all on public.whatsapp_messages to service_role;

-- ── Flow sessions ──────────────────────────────────────────────────────────
-- Meta hands every Flow run a flow_token. We mint it, so it doubles as the
-- server-side handle for that run: which WhatsApp number opened it, which gym
-- it is for, and how far it got. Short TTL — an abandoned signup should not
-- leave a resumable half-open door.
create table if not exists public.whatsapp_flow_sessions (
  flow_token text not null,
  wa_id text not null,
  gym_id uuid,
  kind text not null,
  -- Non-secret scratch only: the resolved gym, the email awaiting verification,
  -- the pending user id. Never a password.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='whatsapp_flow_sessions_pkey' and conrelid='public.whatsapp_flow_sessions'::regclass) then
    alter table public.whatsapp_flow_sessions add constraint whatsapp_flow_sessions_pkey primary key (flow_token);
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_flow_sessions_gym_id_fkey' and conrelid='public.whatsapp_flow_sessions'::regclass) then
    alter table public.whatsapp_flow_sessions add constraint whatsapp_flow_sessions_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_flow_sessions_kind_check' and conrelid='public.whatsapp_flow_sessions'::regclass) then
    alter table public.whatsapp_flow_sessions add constraint whatsapp_flow_sessions_kind_check
      check (kind in ('signup', 'signin', 'checkin', 'payment', 'support'));
  end if;
end $$;

create index if not exists idx_whatsapp_flow_sessions_wa on public.whatsapp_flow_sessions (wa_id, created_at desc);
create index if not exists idx_whatsapp_flow_sessions_expiry on public.whatsapp_flow_sessions (expires_at);

alter table public.whatsapp_flow_sessions enable row level security;
-- No authenticated access at all: this is machine state between Meta and the
-- Flow endpoint, and nothing in the product renders it.
revoke all on public.whatsapp_flow_sessions from anon, authenticated;
grant all on public.whatsapp_flow_sessions to service_role;

-- ── Email verification codes ───────────────────────────────────────────────
-- The user asked for email to be verified once, inside the Flow. A link cannot
-- do that — it would throw them out of WhatsApp into a browser and back — so
-- signup emails a six-digit code and the next Flow screen takes it.
--
-- Only the SHA-256 of the code is stored: a leaked row must not let anyone
-- confirm somebody else's mailbox. attempts is capped in the app so the
-- six-digit space cannot be walked.
create table if not exists public.whatsapp_email_otps (
  id uuid not null default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  purpose text not null default 'signup',
  user_id uuid,
  gym_id uuid,
  wa_id text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='whatsapp_email_otps_pkey' and conrelid='public.whatsapp_email_otps'::regclass) then
    alter table public.whatsapp_email_otps add constraint whatsapp_email_otps_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_email_otps_purpose_check' and conrelid='public.whatsapp_email_otps'::regclass) then
    alter table public.whatsapp_email_otps add constraint whatsapp_email_otps_purpose_check
      check (purpose in ('signup', 'signin', 'recovery'));
  end if;
end $$;

create index if not exists idx_whatsapp_email_otps_lookup
  on public.whatsapp_email_otps (email, purpose, created_at desc) where (consumed_at is null);
create index if not exists idx_whatsapp_email_otps_expiry on public.whatsapp_email_otps (expires_at);

alter table public.whatsapp_email_otps enable row level security;
revoke all on public.whatsapp_email_otps from anon, authenticated;
grant all on public.whatsapp_email_otps to service_role;

-- ── Payment intents ────────────────────────────────────────────────────────
-- A package chosen in WhatsApp, waiting on Paystack. The existing
-- charge.success webhook still does the fulfilling — this row exists so the
-- confirmation can be sent back to the right WhatsApp thread afterwards, and so
-- an abandoned checkout is visible to the gym instead of vanishing.
create table if not exists public.whatsapp_payment_intents (
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  gym_id uuid not null,
  member_id uuid not null,
  plan_id uuid,
  reference text not null,
  amount_kobo bigint not null,
  with_trainer boolean not null default false,
  status text not null default 'pending',
  authorization_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='whatsapp_payment_intents_pkey' and conrelid='public.whatsapp_payment_intents'::regclass) then
    alter table public.whatsapp_payment_intents add constraint whatsapp_payment_intents_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_payment_intents_contact_id_fkey' and conrelid='public.whatsapp_payment_intents'::regclass) then
    alter table public.whatsapp_payment_intents add constraint whatsapp_payment_intents_contact_id_fkey
      foreign key (contact_id) references public.whatsapp_contacts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_payment_intents_gym_id_fkey' and conrelid='public.whatsapp_payment_intents'::regclass) then
    alter table public.whatsapp_payment_intents add constraint whatsapp_payment_intents_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='whatsapp_payment_intents_status_check' and conrelid='public.whatsapp_payment_intents'::regclass) then
    alter table public.whatsapp_payment_intents add constraint whatsapp_payment_intents_status_check
      check (status in ('pending', 'paid', 'abandoned', 'failed'));
  end if;
end $$;

create unique index if not exists idx_whatsapp_payment_intents_ref on public.whatsapp_payment_intents (reference);
create index if not exists idx_whatsapp_payment_intents_gym on public.whatsapp_payment_intents (gym_id, created_at desc);

alter table public.whatsapp_payment_intents enable row level security;

drop policy if exists whatsapp_payment_intents_select_staff on public.whatsapp_payment_intents;
create policy whatsapp_payment_intents_select_staff on public.whatsapp_payment_intents
  as permissive for select to authenticated
  using (private.is_gym_staff(gym_id) or member_id = (select auth.uid()));

revoke insert, update, delete on public.whatsapp_payment_intents from anon, authenticated;
revoke all on public.whatsapp_payment_intents from anon;
grant select on public.whatsapp_payment_intents to authenticated;
grant all on public.whatsapp_payment_intents to service_role;

-- ── AI provider catalogue ──────────────────────────────────────────────────
-- Platform-level, superadmin-managed. A gym picks a provider from this list and
-- either rides the platform key or supplies its own in gym_ai_settings.
--
-- api_key_encrypted is AES-256-GCM ciphertext and is readable by service_role
-- ONLY — the column-level grant below is what enforces that, because a gym
-- owner choosing a provider has no reason to be handed the platform's key.
create table if not exists public.ai_providers (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  -- OpenAI-compatible base URL where applicable; the adapter in
  -- lib/ai/providers.ts knows which vendors need a bespoke request shape.
  base_url text,
  default_model text,
  -- Selectable model ids, e.g. ["claude-opus-5", "claude-sonnet-5"].
  models jsonb not null default '[]'::jsonb,
  api_key_encrypted text,
  enabled boolean not null default false,
  sort_order integer not null default 100,
  docs_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='ai_providers_pkey' and conrelid='public.ai_providers'::regclass) then
    alter table public.ai_providers add constraint ai_providers_pkey primary key (id);
  end if;
end $$;

create unique index if not exists idx_ai_providers_slug on public.ai_providers (slug);

alter table public.ai_providers enable row level security;

-- Gym owners need the catalogue to choose from, so they may read it — but the
-- key column is withheld by grant, not by policy, because RLS is row-level and
-- this is a column-level secret.
drop policy if exists ai_providers_select_authenticated on public.ai_providers;
create policy ai_providers_select_authenticated on public.ai_providers
  as permissive for select to authenticated
  using (true);

drop policy if exists ai_providers_write_platform on public.ai_providers;
create policy ai_providers_write_platform on public.ai_providers
  as permissive for all to authenticated
  using (private.is_platform_admin())
  with check (private.is_platform_admin());

revoke all on public.ai_providers from anon, authenticated;
grant select (id, slug, name, base_url, default_model, models, enabled, sort_order, docs_url, created_at, updated_at)
  on public.ai_providers to authenticated;
grant insert, update, delete on public.ai_providers to authenticated;
grant all on public.ai_providers to service_role;

-- ── Per-gym assistant configuration ────────────────────────────────────────
create table if not exists public.gym_ai_settings (
  gym_id uuid not null,
  provider_slug text,
  model text,
  -- The gym's own vendor key (AES-256-GCM). Null = use the platform key on
  -- ai_providers. Service-role only, same reasoning as above.
  api_key_encrypted text,
  system_prompt text,
  temperature numeric(3,2) not null default 0.30,
  max_tokens integer not null default 600,
  enabled boolean not null default false,
  -- Words that hand the conversation to a human instead of answering.
  handoff_keywords text[] not null default array['human', 'agent', 'complaint', 'refund'],
  -- Spend guard. The adapter refuses once used >= cap and falls back to the
  -- deterministic menu, so a runaway loop cannot bill a gym indefinitely.
  monthly_token_cap integer not null default 200000,
  tokens_used_this_month integer not null default 0,
  usage_period_start date not null default date_trunc('month', now())::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='gym_ai_settings_pkey' and conrelid='public.gym_ai_settings'::regclass) then
    alter table public.gym_ai_settings add constraint gym_ai_settings_pkey primary key (gym_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_ai_settings_gym_id_fkey' and conrelid='public.gym_ai_settings'::regclass) then
    alter table public.gym_ai_settings add constraint gym_ai_settings_gym_id_fkey
      foreign key (gym_id) references public.gyms(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='gym_ai_settings_temperature_check' and conrelid='public.gym_ai_settings'::regclass) then
    alter table public.gym_ai_settings add constraint gym_ai_settings_temperature_check
      check (temperature >= 0 and temperature <= 2);
  end if;
end $$;

alter table public.gym_ai_settings enable row level security;

drop policy if exists gym_ai_settings_select_staff on public.gym_ai_settings;
create policy gym_ai_settings_select_staff on public.gym_ai_settings
  as permissive for select to authenticated
  using (private.is_gym_staff(gym_id));

drop policy if exists gym_ai_settings_write_owner on public.gym_ai_settings;
create policy gym_ai_settings_write_owner on public.gym_ai_settings
  as permissive for all to authenticated
  using (private.has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]))
  with check (private.has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]));

revoke all on public.gym_ai_settings from anon, authenticated;
-- api_key_encrypted is deliberately absent from the SELECT grant: an owner sets
-- a key and is told whether one is present, but never reads it back.
grant select (gym_id, provider_slug, model, system_prompt, temperature, max_tokens, enabled,
              handoff_keywords, monthly_token_cap, tokens_used_this_month, usage_period_start,
              created_at, updated_at)
  on public.gym_ai_settings to authenticated;
grant insert, update, delete on public.gym_ai_settings to authenticated;
grant all on public.gym_ai_settings to service_role;

-- ── Check-in provenance ────────────────────────────────────────────────────
-- Front-desk codes are now generated from two places (the member app and
-- WhatsApp) and redeemed at one (/admin/staff-checkin). Recording which door
-- issued a code keeps the two paths distinguishable in support without
-- splitting the table — redemption logic stays identical, which is exactly the
-- "synced, not duplicated" requirement.
alter table public.checkin_codes add column if not exists source text not null default 'app';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='checkin_codes_source_check' and conrelid='public.checkin_codes'::regclass) then
    alter table public.checkin_codes add constraint checkin_codes_source_check
      check (source in ('app', 'whatsapp'));
  end if;
end $$;

-- ── Seed the provider catalogue ────────────────────────────────────────────
-- Disabled and keyless on insert: enabling one is a superadmin decision made in
-- the portal, and no key ships in source. on conflict updates only the
-- descriptive columns so a re-run refreshes model lists without disturbing a
-- key or an enabled flag someone has already set.
insert into public.ai_providers (slug, name, base_url, default_model, models, sort_order, docs_url) values
  ('anthropic', 'Anthropic (Claude)', 'https://api.anthropic.com/v1',
   'claude-sonnet-5', '["claude-opus-5","claude-sonnet-5","claude-haiku-4-5-20251001"]'::jsonb, 10, 'https://docs.anthropic.com'),
  ('openai', 'OpenAI', 'https://api.openai.com/v1',
   'gpt-4o-mini', '["gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","o3-mini"]'::jsonb, 20, 'https://platform.openai.com/docs'),
  ('google', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta',
   'gemini-2.0-flash', '["gemini-2.5-pro","gemini-2.0-flash","gemini-2.0-flash-lite"]'::jsonb, 30, 'https://ai.google.dev/docs'),
  ('groq', 'Groq', 'https://api.groq.com/openai/v1',
   'llama-3.3-70b-versatile', '["llama-3.3-70b-versatile","llama-3.1-8b-instant","mixtral-8x7b-32768"]'::jsonb, 40, 'https://console.groq.com/docs'),
  ('mistral', 'Mistral AI', 'https://api.mistral.ai/v1',
   'mistral-small-latest', '["mistral-large-latest","mistral-small-latest","open-mistral-nemo"]'::jsonb, 50, 'https://docs.mistral.ai'),
  ('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1',
   'deepseek-chat', '["deepseek-chat","deepseek-reasoner"]'::jsonb, 60, 'https://api-docs.deepseek.com'),
  ('xai', 'xAI (Grok)', 'https://api.x.ai/v1',
   'grok-2-latest', '["grok-2-latest","grok-2-mini"]'::jsonb, 70, 'https://docs.x.ai'),
  ('cohere', 'Cohere', 'https://api.cohere.ai/compatibility/v1',
   'command-r-plus', '["command-r-plus","command-r","command-a-03-2025"]'::jsonb, 80, 'https://docs.cohere.com'),
  ('perplexity', 'Perplexity', 'https://api.perplexity.ai',
   'sonar', '["sonar","sonar-pro","sonar-reasoning"]'::jsonb, 90, 'https://docs.perplexity.ai'),
  ('together', 'Together AI', 'https://api.together.xyz/v1',
   'meta-llama/Llama-3.3-70B-Instruct-Turbo',
   '["meta-llama/Llama-3.3-70B-Instruct-Turbo","Qwen/Qwen2.5-72B-Instruct-Turbo"]'::jsonb, 100, 'https://docs.together.ai'),
  ('fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1',
   'accounts/fireworks/models/llama-v3p3-70b-instruct',
   '["accounts/fireworks/models/llama-v3p3-70b-instruct","accounts/fireworks/models/qwen2p5-72b-instruct"]'::jsonb, 110, 'https://docs.fireworks.ai'),
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1',
   'anthropic/claude-sonnet-5',
   '["anthropic/claude-sonnet-5","openai/gpt-4o-mini","google/gemini-2.0-flash-001","meta-llama/llama-3.3-70b-instruct"]'::jsonb, 120, 'https://openrouter.ai/docs'),
  ('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1',
   'llama-3.3-70b', '["llama-3.3-70b","llama3.1-8b"]'::jsonb, 130, 'https://inference-docs.cerebras.ai'),
  ('azure_openai', 'Azure OpenAI', null,
   'gpt-4o-mini', '["gpt-4o","gpt-4o-mini"]'::jsonb, 140, 'https://learn.microsoft.com/azure/ai-services/openai/'),
  ('bedrock', 'AWS Bedrock', null,
   'anthropic.claude-3-5-sonnet-20241022-v2:0',
   '["anthropic.claude-3-5-sonnet-20241022-v2:0","meta.llama3-3-70b-instruct-v1:0"]'::jsonb, 150, 'https://docs.aws.amazon.com/bedrock/'),
  ('vertex', 'Google Vertex AI', null,
   'gemini-2.0-flash', '["gemini-2.5-pro","gemini-2.0-flash"]'::jsonb, 160, 'https://cloud.google.com/vertex-ai/docs'),
  ('ollama', 'Ollama (self-hosted)', 'http://localhost:11434/v1',
   'llama3.2', '["llama3.2","qwen2.5","mistral"]'::jsonb, 170, 'https://github.com/ollama/ollama'),
  ('huggingface', 'Hugging Face', 'https://router.huggingface.co/v1',
   'meta-llama/Llama-3.3-70B-Instruct', '["meta-llama/Llama-3.3-70B-Instruct","Qwen/Qwen2.5-72B-Instruct"]'::jsonb, 180, 'https://huggingface.co/docs'),
  ('moonshot', 'Moonshot (Kimi)', 'https://api.moonshot.cn/v1',
   'moonshot-v1-8k', '["moonshot-v1-8k","moonshot-v1-32k","kimi-k2-0711-preview"]'::jsonb, 190, 'https://platform.moonshot.cn/docs'),
  ('zhipu', 'Zhipu AI (GLM)', 'https://open.bigmodel.cn/api/paas/v4',
   'glm-4-flash', '["glm-4-plus","glm-4-flash"]'::jsonb, 200, 'https://open.bigmodel.cn/dev/api'),
  ('alibaba', 'Alibaba Cloud (Qwen)', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
   'qwen-plus', '["qwen-max","qwen-plus","qwen-turbo"]'::jsonb, 210, 'https://help.aliyun.com/zh/dashscope/'),
  ('nebius', 'Nebius AI Studio', 'https://api.studio.nebius.ai/v1',
   'meta-llama/Llama-3.3-70B-Instruct', '["meta-llama/Llama-3.3-70B-Instruct","Qwen/Qwen2.5-72B-Instruct"]'::jsonb, 220, 'https://docs.nebius.com/studio/inference')
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(public.ai_providers.base_url, excluded.base_url),
  default_model = excluded.default_model,
  models = excluded.models,
  docs_url = excluded.docs_url,
  sort_order = excluded.sort_order,
  updated_at = now();
