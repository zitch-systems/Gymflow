-- Security hardening: pin search_path on the class-capacity trigger function.
-- Flagged by the Supabase linter (0011_function_search_path_mutable) — a
-- function with a role-mutable search_path can be tricked into resolving an
-- unqualified name to an attacker-controlled object. The body already
-- fully-qualifies every reference (public.*), so pinning the path is a no-op
-- for behaviour and closes the advisory. Idempotent.

create or replace function public.enforce_class_capacity()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  cap integer;
  taken integer;
begin
  if NEW.status is distinct from 'booked' then
    return NEW;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(NEW.class_schedule_id::text || ':' || coalesce(NEW.booking_date::text, ''), 0)
  );

  select c.max_capacity into cap
  from public.class_schedules s
  join public.classes c on c.id = s.class_id
  where s.id = NEW.class_schedule_id;

  if cap is null or cap <= 0 then
    return NEW;
  end if;

  select count(*) into taken
  from public.class_bookings b
  where b.class_schedule_id = NEW.class_schedule_id
    and b.booking_date = NEW.booking_date
    and b.status = 'booked'
    and b.id <> NEW.id;

  if taken >= cap then
    NEW.status := 'waitlisted';
  end if;

  return NEW;
end;
$function$;
