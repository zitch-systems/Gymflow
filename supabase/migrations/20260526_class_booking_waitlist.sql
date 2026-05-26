-- Class booking v2: allow a 'waitlisted' status so full classes can queue members.
-- Apply via Supabase SQL editor / `supabase db push`, or MCP apply_migration.

ALTER TABLE public.class_bookings
  DROP CONSTRAINT IF EXISTS class_bookings_status_check;

ALTER TABLE public.class_bookings
  ADD CONSTRAINT class_bookings_status_check
  CHECK (status = ANY (ARRAY['booked'::text, 'waitlisted'::text, 'attended'::text, 'cancelled'::text, 'no_show'::text]));

-- Speed up capacity counts and waitlist promotion lookups.
CREATE INDEX IF NOT EXISTS idx_class_bookings_schedule_date_status
  ON public.class_bookings (class_schedule_id, booking_date, status);
