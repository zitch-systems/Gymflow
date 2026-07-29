-- Let a day have split sessions, and stop a failed save from wiping the day.
--
-- Two defects, one save button:
--
-- 1. UNIQUE (gym_id, day_of_week) predates the `session` column. Split
--    sessions write one row per session, so any day with both a morning and an
--    evening block failed with
--    "duplicate key value violates unique constraint
--     business_hours_gym_id_day_of_week_key" — the split-sessions feature could
--    never save at all. The constraint still has a job (a day shouldn't carry
--    two morning rows), so it is widened to include the session rather than
--    dropped. `session` is NOT NULL DEFAULT 'all', so no row can dodge the
--    index through a NULL.
--
-- 2. saveBusinessHours deleted every row for the gym and then inserted the new
--    set as two separate statements. When the insert failed — as it always did
--    for a split day — the delete had already committed, so the gym was left
--    with NO opening hours at all: worse than the edit they attempted, and
--    visible on their public landing page. replace_business_hours() does both
--    in one function body, which Postgres runs in a single transaction, so a
--    rejected insert takes the delete down with it.
--
-- SECURITY INVOKER: the caller's own RLS still decides whether they may write
-- this gym's hours (bh_delete_owner / bh_insert_owner — owner and manager
-- only). The function is a transaction boundary, not a privilege escalation,
-- and gym_id comes from the parameter rather than the row payload so a crafted
-- call can't scatter rows across other gyms.
--
-- Idempotent.

alter table public.business_hours drop constraint if exists business_hours_gym_id_day_of_week_key;

create unique index if not exists business_hours_gym_day_session_key
  on public.business_hours (gym_id, day_of_week, session);

create or replace function public.replace_business_hours(p_gym uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
begin
  delete from public.business_hours where gym_id = p_gym;

  insert into public.business_hours (gym_id, day_of_week, open_time, close_time, is_closed, session)
  select
    p_gym,
    (r->>'day_of_week')::int,
    nullif(r->>'open_time', '')::time,
    nullif(r->>'close_time', '')::time,
    coalesce((r->>'is_closed')::boolean, false),
    coalesce(nullif(r->>'session', ''), 'all')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;
end;
$$;

revoke execute on function public.replace_business_hours(uuid, jsonb) from public;
grant execute on function public.replace_business_hours(uuid, jsonb) to authenticated, service_role;
