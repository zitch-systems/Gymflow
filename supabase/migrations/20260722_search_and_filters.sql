-- Member-search performance + wallet filter hygiene.
--
-- 1. Trigram indexes: every member search is a leading-wildcard ILIKE
--    ('%q%') on profiles.full_name / email, which no btree can serve — each
--    search was a sequential scan over ALL profiles platform-wide. pg_trgm
--    GIN indexes make ILIKE '%q%' index-backed.
--
-- 2. gym_payment_methods(): the admin Wallet page fetched up to 1000 payment
--    rows just to derive the DISTINCT set of methods for its filter dropdown.
--    PostgREST has no DISTINCT, so expose it as a one-row-per-method function.
--    SECURITY INVOKER: RLS on payments still decides what the caller can see,
--    so the function leaks nothing a direct SELECT wouldn't.
--
-- Idempotent. Safe to re-run.

create extension if not exists pg_trgm;

create index if not exists idx_profiles_full_name_trgm
  on public.profiles using gin (full_name gin_trgm_ops);

create index if not exists idx_profiles_email_trgm
  on public.profiles using gin (email gin_trgm_ops);

create or replace function public.gym_payment_methods(p_gym uuid)
returns setof text
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select distinct payment_method
  from payments
  where gym_id = p_gym and payment_method is not null
  order by 1
$$;

grant execute on function public.gym_payment_methods(uuid) to authenticated, service_role;
revoke execute on function public.gym_payment_methods(uuid) from anon;
