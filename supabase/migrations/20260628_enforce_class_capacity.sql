-- Atomic class-capacity enforcement.
--
-- The booking flow (lib/actions/booking.ts) counts confirmed seats and then
-- inserts — a check-then-act race: two members booking the last seat at the same
-- time both read count = capacity-1 and both insert 'booked', over-booking the
-- class. The UNIQUE(gym_id, class_schedule_id, member_id) index only stops one
-- member double-booking; it does nothing about the total seat count.
--
-- This BEFORE trigger closes the race in the database: it serializes concurrent
-- bookings for the same (schedule, date) with a transaction-scoped advisory
-- lock, recounts confirmed seats, and DEMOTES an over-capacity 'booked' row to
-- 'waitlisted' — matching the app's "waitlist when full" behavior, so the app
-- code can keep its fast-path count as a UX hint while the DB is authoritative.

create or replace function public.enforce_class_capacity()
returns trigger
language plpgsql
as $$
declare
  cap integer;
  taken integer;
begin
  -- Only confirmed seats consume capacity.
  if NEW.status is distinct from 'booked' then
    return NEW;
  end if;

  -- Serialize bookings for this occurrence so the recount below is consistent
  -- within the transaction (released automatically at commit/rollback).
  perform pg_advisory_xact_lock(
    hashtextextended(NEW.class_schedule_id::text || ':' || coalesce(NEW.booking_date::text, ''), 0)
  );

  select c.max_capacity into cap
  from public.class_schedules s
  join public.classes c on c.id = s.class_id
  where s.id = NEW.class_schedule_id;

  -- null/0 capacity means "no cap".
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
$$;

drop trigger if exists trg_enforce_class_capacity on public.class_bookings;
create trigger trg_enforce_class_capacity
  before insert or update on public.class_bookings
  for each row execute function public.enforce_class_capacity();
