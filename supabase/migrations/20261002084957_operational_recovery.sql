-- Durable operational work and health state.
--
-- Webhooks and scheduled correctness jobs must survive a function timeout or
-- deployment.  All mutation paths below are service-role only.  Platform
-- administrators receive read-only visibility through RLS so the console can
-- show stuck work without exposing provider payloads to tenant users.

create table public.operational_job_state (
  job_name text primary key,
  cursor jsonb not null default '{}'::jsonb,
  watermark timestamptz,
  last_started_at timestamptz,
  last_heartbeat_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  updated_at timestamptz not null default now()
);

create table public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  kind text not null,
  reference text,
  error text not null,
  context jsonb not null default '{}'::jsonb,
  attempts integer not null default 1 check (attempts > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index operational_incidents_open_key_idx
  on public.operational_incidents (dedupe_key) where resolved_at is null;
create index operational_incidents_open_oldest_idx
  on public.operational_incidents (last_seen_at) where resolved_at is null;

create table public.payment_webhook_jobs (
  body_hash text primary key,
  source text not null default 'webhook' check (source in ('webhook', 'reconciliation')),
  event_name text not null,
  reference text,
  payload_ciphertext text not null,
  verified_at timestamptz not null,
  verification_method text not null check (verification_method in ('paystack_hmac', 'paystack_api')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry', 'completed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index payment_webhook_jobs_due_idx
  on public.payment_webhook_jobs (next_attempt_at, received_at)
  where status in ('queued', 'retry', 'processing');

create table public.gym_backup_jobs (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_backup_jobs_due_idx
  on public.gym_backup_jobs (next_attempt_at, due_at);

-- Provider references are retained only long enough to finish a checkpointed
-- reconciliation window.  They avoid holding an unbounded reference set in a
-- serverless function while still allowing the local half of the sweep to be
-- paged in later invocations.
create table public.paystack_reconciliation_refs (
  reference text primary key,
  paid_at timestamptz,
  observed_at timestamptz not null default now()
);
create index paystack_reconciliation_refs_observed_idx
  on public.paystack_reconciliation_refs (observed_at);

alter table public.operational_job_state enable row level security;
alter table public.operational_incidents enable row level security;
alter table public.payment_webhook_jobs enable row level security;
alter table public.gym_backup_jobs enable row level security;
alter table public.paystack_reconciliation_refs enable row level security;

revoke all on public.operational_job_state, public.operational_incidents,
  public.payment_webhook_jobs, public.gym_backup_jobs,
  public.paystack_reconciliation_refs from public, anon, authenticated;
grant all on public.operational_job_state, public.operational_incidents,
  public.payment_webhook_jobs, public.gym_backup_jobs,
  public.paystack_reconciliation_refs to service_role;
grant select on public.operational_job_state, public.operational_incidents,
  public.payment_webhook_jobs, public.gym_backup_jobs to authenticated;

create policy operational_job_state_platform_read on public.operational_job_state
  for select to authenticated using (private.is_platform_admin());
create policy operational_incidents_platform_read on public.operational_incidents
  for select to authenticated using (private.is_platform_admin());
create policy payment_webhook_jobs_platform_read on public.payment_webhook_jobs
  for select to authenticated using (private.is_platform_admin());
create policy gym_backup_jobs_platform_read on public.gym_backup_jobs
  for select to authenticated using (private.is_platform_admin());

insert into public.operational_job_state (job_name)
values ('notifications'), ('gym_backups'), ('paystack_reconciliation'), ('payment_webhook_recovery')
on conflict (job_name) do nothing;

create or replace function public.record_operational_incident(
  p_dedupe_key text,
  p_kind text,
  p_reference text,
  p_error text,
  p_context jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.operational_incidents (dedupe_key, kind, reference, error, context)
  values (left(p_dedupe_key, 160), left(p_kind, 100), left(p_reference, 200), left(p_error, 2000), coalesce(p_context, '{}'::jsonb))
  on conflict (dedupe_key) where resolved_at is null do update
    set error = excluded.error,
        reference = coalesce(excluded.reference, operational_incidents.reference),
        context = excluded.context,
        attempts = operational_incidents.attempts + 1,
        last_seen_at = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.record_operational_incident(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_operational_incident(text,text,text,text,jsonb) to service_role;

create or replace function public.claim_payment_webhook_jobs(
  p_limit integer,
  p_lock_token uuid,
  p_body_hash text default null
) returns setof public.payment_webhook_jobs
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select q.body_hash
    from public.payment_webhook_jobs q
    where (p_body_hash is null or q.body_hash = p_body_hash)
      and (
        (q.status in ('queued', 'retry') and q.next_attempt_at <= now())
        or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
      )
    order by q.next_attempt_at, q.received_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 25))
  )
  update public.payment_webhook_jobs q
     set status = 'processing', attempts = q.attempts + 1,
         locked_at = now(), lock_token = p_lock_token, updated_at = now()
    from candidates c
   where q.body_hash = c.body_hash
  returning q.*;
end $$;

revoke all on function public.claim_payment_webhook_jobs(integer,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_jobs(integer,uuid,text) to service_role;

-- Manual repair is deliberately narrower than table UPDATE. The caller must
-- be a platform administrator whose exact session has a live privileged proof;
-- private.is_platform_admin() owns both checks after the privileged-session
-- hardening migration replaces its implementation.
create or replace function public.requeue_payment_webhook_job(p_body_hash text)
returns boolean
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_changed integer;
begin
  if not private.is_platform_admin() then
    raise exception 'verified platform administrator required' using errcode = '42501';
  end if;
  update public.payment_webhook_jobs
     set status = 'retry', next_attempt_at = now(), locked_at = null,
         lock_token = null, completed_at = null, last_error = null, updated_at = now()
   where body_hash = p_body_hash and status = 'dead';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end $$;

revoke all on function public.requeue_payment_webhook_job(text) from public, anon;
grant execute on function public.requeue_payment_webhook_job(text) to authenticated, service_role;

create or replace function public.enqueue_due_gym_backup_jobs()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.gym_backup_jobs (gym_id, due_at)
  select g.id,
    case g.backup_frequency
      when 'daily' then coalesce(g.backup_last_run_at + interval '1 day', now())
      when 'weekly' then coalesce(g.backup_last_run_at + interval '7 days', now())
      when 'monthly' then coalesce(g.backup_last_run_at + interval '30 days', now())
      else now()
    end
  from public.gyms g
  where g.backup_frequency in ('daily', 'weekly', 'monthly')
    and coalesce(g.status, '') not in ('suspended', 'terminated')
    and (
      g.backup_last_run_at is null
      or (g.backup_frequency = 'daily' and g.backup_last_run_at <= now() - interval '12 hours')
      or (g.backup_frequency = 'weekly' and g.backup_last_run_at <= now() - interval '6 days 12 hours')
      or (g.backup_frequency = 'monthly' and g.backup_last_run_at <= now() - interval '29 days 12 hours')
    )
  on conflict (gym_id) do update set
    due_at = least(gym_backup_jobs.due_at, excluded.due_at),
    updated_at = now()
  where gym_backup_jobs.status in ('queued', 'retry');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.enqueue_due_gym_backup_jobs() from public, anon, authenticated;
grant execute on function public.enqueue_due_gym_backup_jobs() to service_role;

create or replace function public.claim_due_gym_backup_jobs(
  p_limit integer,
  p_lock_token uuid
) returns table (
  gym_id uuid,
  gym_name text,
  gym_status text,
  backup_frequency text,
  backup_email boolean,
  attempts integer,
  due_at timestamptz
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select q.gym_id
    from public.gym_backup_jobs q
    join public.gyms g on g.id = q.gym_id
    where g.backup_frequency in ('daily', 'weekly', 'monthly')
      and coalesce(g.status, '') not in ('suspended', 'terminated')
      and (
        (q.status in ('queued', 'retry') and q.next_attempt_at <= now())
        or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
      )
    order by q.due_at, q.created_at
    for update of q skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 25))
  ), claimed as (
    update public.gym_backup_jobs q
       set status = 'processing', attempts = q.attempts + 1,
           locked_at = now(), lock_token = p_lock_token, updated_at = now()
      from candidates c
     where q.gym_id = c.gym_id
    returning q.gym_id, q.attempts, q.due_at
  )
  select c.gym_id, g.name, g.status, g.backup_frequency, coalesce(g.backup_email, true), c.attempts, c.due_at
  from claimed c join public.gyms g on g.id = c.gym_id
  order by c.due_at;
end $$;

revoke all on function public.claim_due_gym_backup_jobs(integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_due_gym_backup_jobs(integer,uuid) to service_role;
