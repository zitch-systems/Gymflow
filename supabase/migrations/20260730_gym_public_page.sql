-- Data the tenant gym landing page needs (GYM-LANDING-BUILD.md §6). Every item
-- here is a real schema change rather than a hardcoded number on a public page.
--
-- Decisions taken with the owner:
--   · ratings/reviews  → CUT for now (no gym_reviews table, no hero rating)
--   · zones            → real table + admin upload (below), never stock photos
--   · accent / capacity / day pass / joining fee → gym settings columns (below)
--   · busiest hours    → cached aggregate over check-ins (function below)

-- ── 1. Gym settings ────────────────────────────────────────────────────────
-- accent_color/accent_ink drive the ENTIRE page's accent. accent_ink is stored
-- rather than computed at render time because "readable on this accent" is a
-- brand decision: a lime gym wants near-black, a navy gym wants white, and the
-- luminance midpoint guesses wrong either side of the boundary. Default is
-- GymFlow emerald so an un-themed gym still renders correctly.
alter table public.gyms
  add column if not exists accent_color text,
  add column if not exists accent_ink text,
  -- Floor capacity for the live-occupancy bar. Distinct from max_members, which
  -- caps how many people may HOLD a membership; this is how many fit inside.
  add column if not exists capacity integer,
  add column if not exists day_pass_price numeric(12,2),
  -- 0 renders as "None" in the hero facts; null hides the fact entirely.
  add column if not exists joining_fee numeric(12,2);

comment on column public.gyms.accent_color is 'Tenant accent (hex). Drives --accent on the public landing page. Null → GymFlow emerald.';
comment on column public.gyms.accent_ink is 'Readable text colour ON accent_color (hex). Null → derived from accent luminance.';
comment on column public.gyms.capacity is 'How many people fit on the floor at once. Powers the live-occupancy bar; null hides it.';
comment on column public.gyms.day_pass_price is 'Walk-in day pass price. Null hides the day-pass fact.';
comment on column public.gyms.joining_fee is 'One-off joining fee. 0 renders as "None"; null hides the fact.';

-- ── 2. Zones — the gym's own training areas ────────────────────────────────
create table if not exists public.gym_zones (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  blurb text,
  -- Path inside the existing public `gym-assets` bucket, same convention the
  -- gallery uses. Null → the zone renders without a photo rather than borrowing
  -- someone else's floor.
  photo_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gym_zones_gym_sort_idx on public.gym_zones (gym_id, sort_order);

alter table public.gym_zones enable row level security;

-- Public read: this is landing-page content, and the page must render for
-- anonymous visitors (§1 "Auth: Public. No login").
drop policy if exists gym_zones_select_public on public.gym_zones;
create policy gym_zones_select_public on public.gym_zones
  as permissive for select to public
  using (true);

-- Writes stay with the gym's own admins. Mirrors the role array the other
-- gym-settings tables use; instructors are deliberately excluded.
drop policy if exists gym_zones_write_staff on public.gym_zones;
create policy gym_zones_write_staff on public.gym_zones
  as permissive for all to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));

drop trigger if exists gym_zones_updated_at on public.gym_zones;
create trigger gym_zones_updated_at before update on public.gym_zones
  for each row execute function public.update_updated_at();

-- ── 3. Busiest / quietest hours ────────────────────────────────────────────
-- §4 is explicit: this comes from a historical aggregate, not from today, and
-- must not scan raw check-ins per request. SECURITY DEFINER + a fixed
-- search_path so the anonymous page can call it without opening check_ins up:
-- it returns counts by hour only — never a member identity.
create or replace function public.gym_hourly_traffic(p_gym uuid, p_days integer default 30)
  returns table (hour_of_day integer, visits bigint)
  language sql
  stable
  security definer
  set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  -- WAT (UTC+1): gyms and their members are in Lagos, so bucketing in UTC would
  -- attribute a 00:30 WAT check-in to the previous evening.
  select extract(hour from (c.checked_in_at + interval '1 hour'))::int as hour_of_day,
         count(*)::bigint as visits
  from public.check_ins c
  where c.gym_id = p_gym
    and c.checked_in_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1
  order by 1;
$function$;

revoke all on function public.gym_hourly_traffic(uuid, integer) from public;
grant execute on function public.gym_hourly_traffic(uuid, integer) to anon, authenticated, service_role;

comment on function public.gym_hourly_traffic(uuid, integer) is
  'Check-in counts per hour-of-day (WAT) over the last N days, for the public landing page''s busiest/quietest hint. Aggregate only — no member identities.';

-- ── 4. Live occupancy ──────────────────────────────────────────────────────
-- People currently inside: checked in today, not yet checked out. Also
-- SECURITY DEFINER + aggregate-only for the same reason as above.
create or replace function public.gym_live_occupancy(p_gym uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select count(*)::int
  from public.check_ins c
  where c.gym_id = p_gym
    and c.checked_out_at is null
    and (c.checked_in_at + interval '1 hour')::date = (now() + interval '1 hour')::date;
$function$;

revoke all on function public.gym_live_occupancy(uuid) from public;
grant execute on function public.gym_live_occupancy(uuid) to anon, authenticated, service_role;

comment on function public.gym_live_occupancy(uuid) is
  'How many members are currently checked in (WAT day, no check-out yet). Count only — no identities.';
