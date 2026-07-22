-- Deterministic fingerprint of the public schema's STRUCTURE, for the CI
-- drift gate: run against both the shadow DB (built from the repo's
-- migrations) and the live Supabase DB, then diff the outputs.
--
-- Deliberately compares presence/shape (tables, columns, RLS flags, policy
-- names+commands+roles, index names, function signatures, trigger names) and
-- NOT deparsed expression bodies — pg_get_expr output varies across Postgres
-- versions and would false-positive between a vanilla shadow and hosted
-- Supabase. Missing/renamed objects — the drift classes that break a DR
-- rebuild — all surface here.

\pset tuples_only on
\pset format unaligned

select 'TABLE ' || c.relname || ' rls=' || c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select 'COLUMN ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, column_name;

select 'POLICY ' || tablename || '.' || policyname || ' cmd=' || coalesce(cmd, 'ALL') || ' roles=' || array_to_string(roles, ',')
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select 'INDEX ' || tablename || '.' || indexname
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select 'FUNCTION ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

select 'TRIGGER ' || c.relname || '.' || t.tgname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
order by 1;
