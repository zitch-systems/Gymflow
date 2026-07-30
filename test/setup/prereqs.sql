-- Supabase surfaces the baseline schema and RLS policies expect. This file
-- prepares a plain Postgres so the migrations in supabase/migrations/ can be
-- applied against it (DR rebuild path + local tenant-isolation tests).
--
-- It stubs the `auth` schema, the anon/authenticated/service_role Postgres
-- roles, and — crucially — the auth.uid() / auth.role() functions in the exact
-- shape hosted Supabase uses (read GUCs set by PostgREST from the caller's JWT).
-- Tests set those GUCs with SET LOCAL, so RLS is exercised as if a real signed-in
-- user made the query.

create schema if not exists auth;
create schema if not exists extensions;
-- Real Supabase's storage schema; migrations touch it. Minimal stub only.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
insert into storage.buckets(id, name, public)
values ('gym-assets', 'gym-assets', true)
on conflict do nothing;

-- auth.users is referenced by many FKs. Real Supabase manages it; we just need
-- the row for FK integrity in tests.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

-- auth.uid() / auth.role(): read the JWT sub / role from GUCs, exactly as real
-- Supabase does. Tests set these via set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;

-- Roles referenced by policies + grants.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
-- service_role bypasses RLS in real Supabase — the postgres BYPASSRLS attribute
-- is how that's implemented. Grant it here so tests using service_role see all
-- rows (matches production behaviour).
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

-- Let the test runner (postgres superuser) hand out these roles via SET ROLE.
grant anon, authenticated, service_role to current_user;

-- Hosted Supabase grants USAGE on the auth schema to these roles, so a signed-in
-- user can call auth.uid() directly. Without it, only RLS policy expressions
-- (evaluated with the table owner's privileges) can reach auth.uid() — a bare
-- `select auth.uid()`, or a STABLE-but-not-SECURITY-DEFINER helper like
-- can_see_profile() invoked by the user, fails with "permission denied for
-- schema auth" here while working in production. Match production.
grant usage on schema auth to anon, authenticated, service_role;
