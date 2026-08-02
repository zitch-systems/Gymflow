-- Deterministic fingerprint of the public schema, for the CI drift gate: run
-- against both the shadow DB (built from the repo's migrations) and the live
-- Supabase DB, then diff the outputs.
--
-- Two layers:
--   1. STRUCTURE — tables, columns, RLS flags, policy names+commands+roles,
--      index names, function signatures, trigger names. Catches missing or
--      renamed objects, the drift class that breaks a DR rebuild.
--   2. BODIES — normalised hashes of policy expressions and function
--      definitions. A `drop policy` + `create policy` with the same name and
--      command is invisible to layer 1, which is exactly how three security
--      migrations once sat unapplied on the live project while this gate would
--      have reported no drift: the fixes rewrote policy predicates and function
--      bodies without changing a single name.
--
-- Layer 2 compares deparsed SQL between two servers, so the shadow Postgres
-- MUST be the same major version as the live project (both 17 today — see the
-- service image in .github/workflows/ci.yml). Extension-owned functions are
-- excluded: they are not repo-managed and their bodies track the extension
-- version, not our migrations.
--
-- Every section orders by the emitted line under the C collation (hence the
-- subquery wrapper — an ORDER BY expression can't see an output alias): the two
-- servers can have different default collations, which would reorder identical
-- content and read as a diff.

\pset tuples_only on
\pset format unaligned

select line from (
  select 'TABLE ' || c.relname || ' rls=' || c.relrowsecurity as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
) s order by line collate "C";

select line from (
  select 'COLUMN ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable as line
  from information_schema.columns
  where table_schema = 'public'
) s order by line collate "C";

select line from (
  select 'POLICY ' || tablename || '.' || policyname || ' cmd=' || coalesce(cmd, 'ALL') || ' roles=' || array_to_string(roles, ',') as line
  from pg_policies
  where schemaname = 'public'
) s order by line collate "C";

select line from (
  select 'INDEX ' || tablename || '.' || indexname as line
  from pg_indexes
  where schemaname = 'public'
) s order by line collate "C";

-- Functions cover `private` as well as `public`. The RBAC helpers
-- (has_gym_role / is_gym_staff / is_platform_admin) moved to `private` in
-- 20260731184722 and are called by ~20 RLS policies, so a redefined
-- is_platform_admin() there would hand out platform-admin reach across every
-- tenant while a public-only fingerprint reported no drift at all.
select line from (
  select 'FUNCTION ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
) s order by line collate "C";

-- Who may EXECUTE those functions. Several migrations exist purely to revoke
-- anon's execute on SECURITY DEFINER helpers; a silently restored grant is a
-- privilege escalation that changes no name and no body, so neither of the
-- other layers would see it.
select line from (
  select 'FUNCTIONGRANT ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' ||
         g.grantee || '=' || has_function_privilege(g.grantee, p.oid, 'EXECUTE') as line
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as g(grantee)
  where n.nspname in ('public', 'private')
    and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
) s order by line collate "C";

select line from (
  select 'TRIGGER ' || c.relname || '.' || t.tgname as line
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
) s order by line collate "C";

-- Layer 2: bodies. Normalise CRLF and runs of whitespace before hashing, so a
-- migration reformatted on a different platform doesn't read as drift. The hash
-- names the object that changed; `git log -S` on the policy/function name finds
-- what it should be.

select line from (
  select 'POLICYBODY ' || c.relname || '.' || p.polname || ' ' ||
         md5(regexp_replace(
               replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
                       coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), E'\r', ''),
               '\s+', ' ', 'g')) as line
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
) s order by line collate "C";

select line from (
  select 'FUNCTIONBODY ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' ||
         md5(regexp_replace(replace(pg_get_functiondef(p.oid), E'\r', ''), '\s+', ' ', 'g')) as line
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
) s order by line collate "C";
