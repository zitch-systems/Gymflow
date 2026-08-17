-- Platform-wide defaults, editable by the platform team.
--
-- The commission GymFlow takes from member dues had three different answers
-- depending on where you looked:
--
--   • lib/paystack.ts        DEFAULT_PLATFORM_COMMISSION_PCT = 1
--   • gyms.platform_commission_pct   column default 5.00 (what every live gym is on)
--   • /superadmin/settings   a hardcoded, disabled input reading "3%"
--
-- The console one was pure decoration — a mock left from the design prototype —
-- so the platform's own dashboard stated a rate it does not charge. This table
-- is the single answer. The code constant stays as a last-resort fallback for
-- the paths that run before any row exists (and for local dev with no seed).
--
-- Deliberately a singleton: `id` is a boolean pinned to true, so the primary key
-- admits exactly one row. A key/value settings table would have been more
-- "flexible" and would have cost every reader a cast and a null check; this is
-- one row with typed columns, and adding a setting is adding a column.

create table if not exists public.platform_settings (
  id boolean not null default true,
  -- What a NEWLY provisioned gym starts on. Changing it must not re-price live
  -- tenants — each gym carries its own gyms.platform_commission_pct, set at
  -- provision time from this value and editable per gym from the console.
  default_commission_pct numeric(5,2) not null default 5.00,
  -- Trial length for new gyms, in days. Same story as the commission: the
  -- console showed "14 days" as a disabled input while lib/actions/onboard.ts
  -- hardcoded 14 in a date expression.
  default_trial_days integer not null default 14,
  updated_at timestamptz not null default now(),
  -- Who last changed it. Platform-level money settings should not change
  -- without a name attached; the audit log carries the rest.
  updated_by uuid
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='platform_settings_pkey' and conrelid='public.platform_settings'::regclass) then
    alter table public.platform_settings add constraint platform_settings_pkey primary key (id);
  end if;
end $$;

-- The singleton lock: id can only ever be true, so there is exactly one row.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='platform_settings_singleton' and conrelid='public.platform_settings'::regclass) then
    alter table public.platform_settings add constraint platform_settings_singleton check (id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='platform_settings_commission_range' and conrelid='public.platform_settings'::regclass) then
    alter table public.platform_settings add constraint platform_settings_commission_range
      check (default_commission_pct >= 0 and default_commission_pct <= 100);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='platform_settings_trial_range' and conrelid='public.platform_settings'::regclass) then
    alter table public.platform_settings add constraint platform_settings_trial_range
      check (default_trial_days >= 0 and default_trial_days <= 365);
  end if;
end $$;

-- Seed the row with what live is actually on today (5%), not with the code
-- constant — this table is meant to record reality, and changing every gym's
-- economics as a side effect of a migration would be an unpleasant surprise.
insert into public.platform_settings (id, default_commission_pct, default_trial_days)
values (true, 5.00, 14)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Readable by any signed-in user: a gym owner's provisioning path and the
-- pricing surfaces want the default, and there is nothing secret in it. Writes
-- are platform-only.
drop policy if exists platform_settings_select_authenticated on public.platform_settings;
create policy platform_settings_select_authenticated on public.platform_settings
  as permissive for select to authenticated
  using (true);

drop policy if exists platform_settings_write_platform on public.platform_settings;
create policy platform_settings_write_platform on public.platform_settings
  as permissive for all to authenticated
  using (private.is_platform_admin())
  with check (private.is_platform_admin());

revoke all on public.platform_settings from anon;
grant select on public.platform_settings to authenticated;
grant update on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

comment on table public.platform_settings is
  'Singleton row of platform-wide defaults for newly provisioned gyms. Writes are platform-admin only (platform_settings_write_platform).';
