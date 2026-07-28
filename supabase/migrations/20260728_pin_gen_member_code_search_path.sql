-- Pin gen_member_code's search_path.
--
-- The function runs as a column DEFAULT on public.gyms, so it executes with
-- whatever search_path the inserting session happens to carry — a session that
-- puts a temp schema first could shadow public.gyms with its own table and
-- steer the uniqueness check. Same fix, same reason as
-- 20260713_pin_enforce_class_capacity_search_path.sql (Supabase advisor 0011).
--
-- Body is unchanged from 20260717_gym_member_code.sql; only the search_path
-- setting is added. Idempotent.

create or replace function public.gen_member_code()
  returns text
  language plpgsql
  set search_path to 'public', 'pg_temp'
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
