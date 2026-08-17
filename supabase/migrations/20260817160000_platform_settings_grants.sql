-- Tighten the table-level grants on platform_settings.
--
-- 20260817140000_platform_settings.sql revoked from `anon` and then granted
-- select + update to `authenticated`. What it did NOT do is revoke from
-- `authenticated` first — and a Supabase project's default privileges hand the
-- authenticated role all four verbs on every new table in `public`. So the
-- table ended up carrying INSERT and DELETE that the migration never asked for.
--
-- Nothing was exposed by it: RLS is on, and platform_settings_write_platform
-- gates every write behind private.is_platform_admin(), so an ordinary session's
-- INSERT or DELETE is refused by the policy regardless of the grant. But a
-- privilege nobody granted on purpose is one nobody is watching, and the
-- shadow-DB drift gate compares live against exactly what these files say.
--
-- The rule elsewhere in this repo (ai_providers, gym_backups,
-- gym_whatsapp_settings) is revoke-from-both then grant back what is needed.
-- This brings platform_settings onto it. Corrective rather than an edit to the
-- original: migrations are immutable once applied — scripts/migrate.mjs refuses
-- to run when an applied file's checksum has changed.
--
-- SELECT stays broad on purpose: a gym owner's provisioning path reads the
-- default, and there is nothing secret in a commission percentage. UPDATE stays
-- because the console's save action runs as a platform admin under RLS.

revoke insert, delete on public.platform_settings from authenticated;

-- Restated, not because they are missing, but so this file alone describes the
-- table's finished grant state rather than a diff a reader has to apply in their
-- head against the migration before it.
grant select, update on public.platform_settings to authenticated;
revoke all on public.platform_settings from anon;
grant all on public.platform_settings to service_role;
