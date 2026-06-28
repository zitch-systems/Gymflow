-- Performance indexes for the hot multi-tenant filter/sort paths.
--
-- All statements are idempotent (IF NOT EXISTS). The base schema is applied to
-- the live project outside this repo, so some of these may already exist under
-- a different name — verify with `select * from pg_indexes where schemaname =
-- 'public'` (or the Supabase performance advisor) before applying, and drop any
-- that duplicate an existing index. Created CONCURRENTLY-free here for migration
-- simplicity; for a large live table, add CONCURRENTLY and run outside a txn.

-- DAL role gates run on EVERY authenticated request (lib/auth/dal.ts).
create index if not exists gsl_user_active_idx
  on public.gym_staff_links (user_id, is_active);
create index if not exists gml_user_active_idx
  on public.gym_member_links (user_id, is_active);

-- Member/admin list + roster queries scoped by gym.
create index if not exists gml_gym_active_joined_idx
  on public.gym_member_links (gym_id, is_active, joined_at desc);

-- Subscription lookups (dashboard, renewals, reminders, expiry gate).
create index if not exists msub_gym_status_end_idx
  on public.member_subscriptions (gym_id, status, end_date);
create index if not exists msub_member_gym_idx
  on public.member_subscriptions (member_id, gym_id);

-- Payments (wallet, analytics, member detail).
create index if not exists payments_gym_date_idx
  on public.payments (gym_id, payment_date desc);

-- Check-ins (staff check-in, analytics, dashboard, streaks).
create index if not exists checkins_gym_time_idx
  on public.check_ins (gym_id, checked_in_at desc);
create index if not exists checkins_member_gym_time_idx
  on public.check_ins (member_id, gym_id, checked_in_at desc);

-- Class bookings (member dashboard, capacity counts, waitlist promotion).
create index if not exists cb_member_gym_status_idx
  on public.class_bookings (member_id, gym_id, status);
create index if not exists cb_schedule_date_status_idx
  on public.class_bookings (class_schedule_id, booking_date, status);

-- Notifications (member unread badge/inbox + renewal-reminder dedup).
create index if not exists notifications_user_read_idx
  on public.notifications (user_id, is_read);
create index if not exists notifications_user_type_created_idx
  on public.notifications (user_id, type, created_at desc);

-- Audit log (superadmin audit feed).
create index if not exists audit_created_idx
  on public.audit_logs (created_at desc);
