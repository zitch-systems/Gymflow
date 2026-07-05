-- Fixed-window rate limiting, backed by Postgres.
--
-- Why Postgres and not Redis: every serverless instance already shares this
-- database, the write volume is tiny (only throttled endpoints call it), and
-- it needs no new service or credentials. The app-side interface
-- (lib/rate-limit.ts) is store-agnostic — swap in Upstash later without
-- touching call sites.
--
-- The table is service-role-only: no policies, and EXECUTE on the counter
-- function is revoked from anon/authenticated so it can't be burned via
-- PostgREST RPC.

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Atomic hit-and-check: one upsert decides "still inside the window → bump"
-- vs "window expired → reset", then reports whether the caller is under the
-- limit. Single statement, so concurrent hits can't double-count past the cap
-- unnoticed (the ON CONFLICT path serialises on the row).
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_allowed boolean;
begin
  insert into rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else rl.count + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else rl.window_start
    end
  returning count <= p_max into v_allowed;
  return v_allowed;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
