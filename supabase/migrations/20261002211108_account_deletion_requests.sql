-- Account-wide privacy requests survive tenant suspension and Auth erasure.
-- No FK to auth/users or profiles: cascading erasure must not erase the receipt.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  processed_by uuid,
  completion_reference text,
  retention_summary text,
  confirmation_sent_at timestamptz,
  constraint deletion_due_after_request check (due_at >= requested_at),
  constraint deletion_completion_evidence check (
    (status <> 'completed' and completed_at is null and confirmation_sent_at is null)
    or (status = 'completed' and completed_at is not null and processed_by is not null
      and confirmation_sent_at is not null and coalesce(length(btrim(completion_reference)), 0) between 5 and 300
      and coalesce(length(btrim(retention_summary)), 0) between 5 and 1000)
  )
);
create index account_deletion_open_due_idx on public.account_deletion_requests (due_at)
  where status <> 'completed';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select (id, subject_id, status, requested_at, due_at, updated_at, completed_at)
  on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
create policy account_deletion_subject_read on public.account_deletion_requests for select
  to authenticated using (subject_id = (select auth.uid()));

create table public.account_deletion_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.account_deletion_requests(id) on delete restrict,
  actor_id uuid not null,
  previous_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);
create index account_deletion_events_request_idx on public.account_deletion_events (request_id, created_at);
alter table public.account_deletion_events enable row level security;
revoke all on public.account_deletion_events from public, anon, authenticated;
grant select, insert on public.account_deletion_events to service_role;
grant usage, select on sequence public.account_deletion_events_id_seq to service_role;

-- Only the current, proven privileged session may change a request. The
-- private definer holds queue-write rights; the exposed wrapper is invoker.
create function private.review_account_deletion_request(
  p_request_id uuid, p_actor_id uuid, p_expected_status text, p_status text,
  p_erasure_completed boolean default false, p_confirmation_sent boolean default false,
  p_completion_reference text default null, p_retention_summary text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_request public.account_deletion_requests%rowtype;
begin
  if p_actor_id is distinct from auth.uid() or not private.is_platform_admin() then
    raise exception 'Verified platform administrator required' using errcode = '42501';
  end if;
  select * into v_request from public.account_deletion_requests where id = p_request_id for update;
  if not found or v_request.status is distinct from p_expected_status then return false; end if;
  if not ((v_request.status = 'pending' and p_status = 'processing')
      or (v_request.status = 'processing' and p_status = 'completed')) then
    raise exception 'Invalid account deletion transition' using errcode = '22023';
  end if;
  if p_status = 'completed' and (p_erasure_completed is distinct from true
      or p_confirmation_sent is distinct from true
      or coalesce(length(btrim(p_completion_reference)), 0) not between 5 and 300
      or coalesce(length(btrim(p_retention_summary)), 0) not between 5 and 1000) then
    raise exception 'Erasure, confirmation and completion evidence are required' using errcode = '22023';
  end if;
  update public.account_deletion_requests set status = p_status, updated_at = now(), processed_by = p_actor_id,
    completed_at = case when p_status = 'completed' then now() else null end,
    confirmation_sent_at = case when p_status = 'completed' then now() else null end,
    completion_reference = case when p_status = 'completed' then btrim(p_completion_reference) else null end,
    retention_summary = case when p_status = 'completed' then btrim(p_retention_summary) else null end
    where id = p_request_id;
  insert into public.account_deletion_events (request_id, actor_id, previous_status, new_status)
    values (p_request_id, p_actor_id, v_request.status, p_status);
  return true;
end;
$$;
revoke all on function private.review_account_deletion_request(uuid, uuid, text, text, boolean, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.review_account_deletion_request(uuid, uuid, text, text, boolean, boolean, text, text)
  to authenticated;

create function public.review_account_deletion_request(
  p_request_id uuid, p_actor_id uuid, p_expected_status text, p_status text,
  p_erasure_completed boolean default false, p_confirmation_sent boolean default false,
  p_completion_reference text default null, p_retention_summary text default null
) returns boolean language sql security invoker set search_path = '' as $$
  select private.review_account_deletion_request(p_request_id, p_actor_id, p_expected_status,
    p_status, p_erasure_completed, p_confirmation_sent, p_completion_reference, p_retention_summary);
$$;
revoke all on function public.review_account_deletion_request(uuid, uuid, text, text, boolean, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_account_deletion_request(uuid, uuid, text, text, boolean, boolean, text, text)
  to authenticated;
