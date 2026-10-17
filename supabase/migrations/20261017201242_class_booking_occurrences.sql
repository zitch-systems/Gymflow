-- A booking is a seat at one occurrence, not a permanent row for a timetable.
-- Member UPDATE is intentionally restricted to cancellation. New/repeated
-- bookings therefore insert a new row, preserving attendance and cancellations.
-- The old constraint is stricter than this index, so existing rows cannot
-- conflict. Create the replacement before dropping the old protection.
create unique index if not exists class_bookings_active_occurrence_uniq
  on public.class_bookings (gym_id, class_schedule_id, member_id, booking_date)
  where status in ('booked', 'waitlisted');

alter table public.class_bookings
  drop constraint if exists class_bookings_gym_id_class_schedule_id_member_id_key;
drop index if exists public.class_bookings_gym_sched_member_uniq;

-- Members can read only their own bookings. Capacity must count every seat
-- under the existing transaction advisory lock, including other members' RLS
-- rows. This narrowly scoped trigger only derives NEW.status; all insert and
-- cancellation authorization remains in RLS and validate_class_booking_write.
alter function public.enforce_class_capacity() security definer;
revoke all on function public.enforce_class_capacity() from public, anon, authenticated;
