-- Enforce one booking row per (gym, class_schedule, member).
--
-- The booking action (lib/actions/booking.ts) looks up a member's single
-- existing row for a schedule and re-activates it (booked / waitlisted /
-- cancelled) instead of inserting a new one, on the assumption that this
-- combination is unique. This migration makes that assumption a hard DB
-- guarantee. It is self-healing and idempotent: it collapses any pre-existing
-- duplicates first, then adds the unique index only if it isn't already there.

-- 1) Collapse duplicates, keeping the most recently touched row per group.
delete from public.class_bookings
where id in (
  select id from (
    select id,
           row_number() over (
             partition by gym_id, class_schedule_id, member_id
             order by coalesce(booked_at, created_at) desc nulls last, id desc
           ) as rn
    from public.class_bookings
    where gym_id is not null and class_schedule_id is not null and member_id is not null
  ) ranked
  where ranked.rn > 1
);

-- 2) Add the uniqueness guarantee.
create unique index if not exists class_bookings_gym_sched_member_uniq
  on public.class_bookings (gym_id, class_schedule_id, member_id);
