-- Per-gym short "member code" for the native mobile app. The universal app asks
-- the user for their gym's code, resolves the gym from it, then scopes sign-up /
-- sign-in to that gym (web keeps using the slug-based /join links). Codes are
-- 6 chars from an unambiguous alphabet (no 0/O/1/I/L) so they're easy to read
-- out and type on a phone. Generated in the DB so every gym gets one no matter
-- which path creates it (self-signup, platform onboard, tests). Idempotent.

alter table public.gyms add column if not exists member_code text;

-- Random 6-char code, retried until unique against existing gyms. Uncommitted
-- rows in the same transaction are visible to the EXISTS check, so a batch
-- backfill can't hand out the same code twice.
create or replace function public.gen_member_code()
  returns text
  language plpgsql
as $function$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gyms where member_code = code);
  end loop;
  return code;
end;
$function$;

-- Backfill existing gyms one at a time (unique per row).
do $$
declare
  r record;
begin
  for r in select id from public.gyms where member_code is null loop
    update public.gyms set member_code = public.gen_member_code() where id = r.id;
  end loop;
end $$;

alter table public.gyms alter column member_code set default public.gen_member_code();
create unique index if not exists gyms_member_code_key on public.gyms (member_code);
alter table public.gyms alter column member_code set not null;

comment on column public.gyms.member_code is 'Short unambiguous code members type into the native mobile app to reach this gym before signing in/up.';
