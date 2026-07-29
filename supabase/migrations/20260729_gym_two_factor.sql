-- Email two-factor for gym staff + the tables the challenge flow needs.
--
-- Threat model: a stolen or reused staff password. The console it opens holds
-- member PII, payment history and payout destinations, so password-alone is
-- too thin. The second factor is a 6-digit code emailed to the account's own
-- address — chosen over TOTP because every gym already has mail and nothing
-- else to install, and over SMS because Termii delivery is best-effort.
--
-- Three pieces:
--
-- 1. gyms.two_factor_required — per-gym switch, ON by default (including for
--    every gym that already exists). A manager can turn it off in Settings →
--    Security. Staff linked to several gyms are challenged if ANY of their
--    gyms requires it: the stricter gym's policy wins.
--
-- 2. auth_challenges — one row per issued code. The code itself is never
--    stored: code_hash is sha256(challenge_id || code), so a leaked table is
--    not a set of usable codes, and possession of the challenge id (held in an
--    httpOnly cookie) is required to even attempt one. attempts caps guessing
--    at 5 tries per challenge; expires_at retires it after 10 minutes.
--
-- 3. trusted_devices — "trust this device for 30 days". Only the sha256 of the
--    device token is stored, same reasoning as above; the raw token lives in
--    an httpOnly cookie on the staff member's browser.
--
-- Both tables are service-role-only (RLS on, no policies, privileges revoked)
-- exactly like rate_limits and webhook_events: the auth actions are the only
-- readers/writers and they run with the service role. Nothing here is
-- reachable through PostgREST. The daily cron GCs expired rows.
--
-- Idempotent.

alter table public.gyms add column if not exists two_factor_required boolean not null default true;

comment on column public.gyms.two_factor_required is
  'Require an emailed 6-digit code as a second factor for this gym''s staff sign-ins. Settings → Security.';

create table if not exists public.auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  -- sha256(challenge_id || code) — never the code itself.
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_challenges_user on public.auth_challenges (user_id, created_at desc);
create index if not exists idx_auth_challenges_expires on public.auth_challenges (expires_at);

alter table public.auth_challenges enable row level security;
revoke all on public.auth_challenges from anon, authenticated;
grant all on public.auth_challenges to service_role;

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- sha256(device token) — the raw token only ever exists in the user's cookie.
  token_hash text not null unique,
  -- Coarse "Chrome on Windows"-style label so a human can recognise a row when
  -- reviewing or revoking. Never the full user-agent string.
  label text,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_trusted_devices_user on public.trusted_devices (user_id, expires_at desc);
create index if not exists idx_trusted_devices_expires on public.trusted_devices (expires_at);

alter table public.trusted_devices enable row level security;
revoke all on public.trusted_devices from anon, authenticated;
grant all on public.trusted_devices to service_role;
