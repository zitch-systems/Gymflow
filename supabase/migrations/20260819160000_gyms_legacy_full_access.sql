-- Grandfather existing gyms through the Starter repositioning (member app /
-- instructor portal / WhatsApp+AI console moved to Growth-only). Every gym
-- that already existed when this migration runs keeps what it had; only
-- Starter gyms that sign up AFTER this point get the narrower "admin portal
-- only" plan. See lib/entitlements.ts gymCanUse / GRANDFATHERED_FEATURES.
--
-- The backfill UPDATE only touches rows that exist at migration time — a gym
-- inserted a second later gets the column's default (false) automatically, so
-- this stays correct without an expiry date anyone has to remember to remove.

alter table public.gyms
  add column if not exists legacy_full_access boolean not null default false;

update public.gyms set legacy_full_access = true;

comment on column public.gyms.legacy_full_access is
  'True for every gym that existed before the Starter/Growth repositioning (member app, instructor portal, WhatsApp+AI console moved to Growth-only) — grandfathers them through it regardless of tier. New gyms default false. See lib/entitlements.ts gymCanUse.';
