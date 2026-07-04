-- ============================================================================
-- GymFlow — baseline schema + core RLS
-- ============================================================================
-- Full snapshot of the live Supabase schema (project kdbbrxqxqewbjoozmfhq),
-- reconstructed from the catalog so the database can be rebuilt from this repo
-- alone (disaster recovery, local dev, tenant-isolation testing). Prior to this
-- file only 11 incremental migrations existed; the 35-table base schema and its
-- ~95 RLS policies lived only on the hosted project (AUDIT.md's standing #1 P0).
--
-- IDEMPOTENT: every statement guards itself (create ... if not exists, do-block
-- type guards, drop policy/trigger if exists before create, create or replace).
-- It is safe to run on an empty database (DR rebuild) and on top of the existing
-- project, and it co-exists with the later dated incremental migrations, which
-- re-assert subsets of this state.
--
-- OPERATIONAL NOTE: on a database that already has this schema (the live
-- project), mark this migration applied without running it:
--   supabase migration repair --status applied 00000000000000
-- Fresh environments (local `supabase db reset`, a restored DR project) run it
-- normally.
--
-- Objects: 10 enums · 35 tables · 1 view · 21 functions · 17 table triggers +
-- 1 auth.users trigger + 1 event trigger · 95 policies · grants.
-- ============================================================================

set check_function_bodies = off;

-- gen_random_uuid() (column defaults) is a core function on PG13+; no extension
-- required on this Postgres 17 project.

-- ─── Enums ──────────────────────────────────────────────────────────────────
do $$ begin create type public.equipment_condition as enum ('excellent', 'good', 'fair', 'needs_repair', 'out_of_service'); exception when duplicate_object then null; end $$;
do $$ begin create type public.expense_category as enum ('utilities', 'maintenance', 'supplies', 'salaries', 'rent', 'marketing', 'equipment', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.gym_status as enum ('active', 'suspended', 'terminated', 'trial'); exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_channel as enum ('email', 'whatsapp', 'sms'); exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_event as enum ('welcome', 'payment_receipt', 'expiry_reminder_7', 'expiry_reminder_3', 'expiry_reminder_1', 'membership_expired', 'auto_renewal_success', 'auto_renewal_failed', 'pause_approved', 'login_credentials', 'check_in_confirmation'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_method as enum ('card', 'bank_transfer', 'cash', 'auto_debit'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('successful', 'failed', 'pending', 'refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type public.salary_frequency as enum ('monthly', 'weekly', 'biweekly'); exception when duplicate_object then null; end $$;
do $$ begin create type public.subscription_status as enum ('active', 'paused', 'pause_requested', 'expired', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.user_role as enum ('platform_admin', 'gym_owner', 'manager', 'front_desk', 'accountant', 'instructor', 'member'); exception when duplicate_object then null; end $$;

-- ─── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  created_at timestamp with time zone not null default now(),
  user_id uuid
);

create table if not exists public.business_hours (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  day_of_week integer not null,
  open_time time without time zone,
  close_time time without time zone,
  is_closed boolean default false,
  created_at timestamp with time zone default now()
);

create table if not exists public.check_ins (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  member_id uuid,
  checked_in_at timestamp with time zone default now(),
  checked_out_at timestamp with time zone,
  status text default 'active'::text,
  notes text,
  created_at timestamp with time zone default now(),
  device_info text,
  check_in_method text default 'manual'::text
);

create table if not exists public.class_bookings (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  class_schedule_id uuid,
  class_id uuid,
  member_id uuid,
  status text default 'booked'::text,
  booking_date date default CURRENT_DATE,
  booked_at timestamp with time zone default now(),
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  checked_in boolean default false
);

create table if not exists public.class_schedules (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  class_id uuid,
  instructor_id uuid,
  day_of_week integer not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  room text,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.classes (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  name text not null,
  description text,
  instructor_id uuid,
  max_capacity integer default 20,
  duration_minutes integer default 60,
  category text,
  level text default 'all'::text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  day_of_week text not null default 'Monday'::text,
  start_time text not null default '09:00'::text,
  end_time text not null default '10:00'::text,
  instructor text
);

create table if not exists public.client_errors (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  user_id uuid,
  page text,
  error_type text,
  message text,
  stack text,
  severity text default 'error'::text,
  user_agent text,
  created_at timestamp with time zone default now(),
  page_url text
);

create table if not exists public.equipment (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  name text not null,
  category text default 'General'::text,
  description text,
  serial_number text,
  purchase_date date,
  purchase_price numeric(12,2) default 0,
  vendor text,
  warranty_expiry date,
  status text default 'active'::text,
  location text,
  photo_url text,
  last_maintenance_date date,
  next_maintenance_date date,
  maintenance_notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.equipment_maintenance (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  equipment_id uuid not null,
  maintenance_type text not null,
  description text,
  cost numeric(12,2) default 0,
  performed_by text,
  performed_at date default CURRENT_DATE,
  next_due date,
  status text default 'completed'::text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.expenses (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  category text not null,
  description text,
  amount numeric(12,2) not null,
  expense_date date default CURRENT_DATE,
  receipt_url text,
  is_recurring boolean default false,
  recurring_frequency text,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.export_logs (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  filter text,
  member_count integer,
  created_at timestamp with time zone default now()
);

create table if not exists public.gym_member_links (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  user_id uuid,
  member_id uuid,
  joined_at timestamp with time zone default now(),
  onboarding_method text default 'self_signup'::text,
  status text default 'active'::text,
  is_active boolean default true
);

create table if not exists public.gym_staff_links (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  user_id uuid not null,
  role user_role not null,
  salary numeric(12,2),
  salary_frequency salary_frequency default 'monthly'::salary_frequency,
  bank_name text,
  bank_account_number text,
  hire_date date,
  terminated_at timestamp with time zone,
  termination_reason text,
  is_active boolean default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  joined_at timestamp with time zone default now(),
  status text default 'active'::text
);

create table if not exists public.gyms (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  logo_url text,
  address text,
  city text,
  state text,
  country text default 'Nigeria'::text,
  phone text,
  email text,
  website text,
  status text default 'active'::text,
  trial_ends_at timestamp with time zone,
  subscription_status text default 'trial'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  timezone text default 'Africa/Lagos'::text,
  currency text default 'NGN'::text,
  max_members integer default 500,
  subscription_plan text default 'starter'::text,
  tagline text,
  hero_image_url text,
  landing_enabled boolean not null default true,
  landing_content text,
  instructor_revenue_share_pct integer not null default 50,
  paystack_subaccount_code text,
  bank_code text,
  bank_name text,
  account_number text,
  account_name text,
  platform_commission_pct numeric(5,2) not null default 5.00,
  brand_color text,
  paystack_subscription_code text,
  paystack_customer_code text,
  subscription_current_period_end timestamp with time zone
);

create table if not exists public.instructor_bank_details (
  instructor_id uuid not null,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.instructor_payouts (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  instructor_id uuid not null,
  amount numeric(10,2) not null,
  status text not null default 'requested'::text,
  notes text,
  processed_by uuid,
  processed_at timestamp with time zone,
  requested_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  bank_code text,
  bank_name text,
  account_number text,
  account_name text,
  paystack_transfer_code text,
  paystack_recipient_code text
);

create table if not exists public.instructor_pricing (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  instructor_id uuid not null,
  duration_days integer not null,
  price numeric(12,2) not null,
  is_active boolean default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  plan_name text,
  currency text default 'NGN'::text,
  billing_period text default 'monthly'::text,
  features jsonb default '[]'::jsonb
);

create table if not exists public.instructor_sessions (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  instructor_id uuid not null,
  member_id uuid not null,
  scheduled_at timestamp with time zone not null,
  duration_minutes integer not null default 60,
  status text not null default 'scheduled'::text,
  notes text,
  marked_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.instructor_subscriptions (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  instructor_id uuid not null,
  plan_id uuid,
  status text default 'active'::text,
  start_date date default CURRENT_DATE,
  end_date date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  amount_paid numeric default 0,
  payment_reference text,
  member_id uuid,
  auto_renew boolean not null default false
);

create table if not exists public.member_subscriptions (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  member_id uuid not null,
  plan_id uuid,
  start_date date not null default CURRENT_DATE,
  end_date date not null,
  status text default 'active'::text,
  auto_debit_enabled boolean default false,
  payment_method text default 'card'::text,
  paystack_subscription_code text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.membership_plans (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  name text not null,
  description text,
  duration_months integer not null,
  price numeric(12,2) not null,
  currency text default 'NGN'::text,
  features jsonb default '[]'::jsonb,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  duration_days integer
);

create table if not exists public.memberships (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  member_id uuid,
  plan_id uuid,
  start_date date not null,
  end_date date not null,
  status text default 'active'::text,
  auto_renew boolean default false,
  payment_method text default 'card'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  auto_debit_enabled boolean default false,
  paused_at timestamp with time zone,
  pause_reason text
);

create table if not exists public.notifications (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  user_id uuid,
  title text not null,
  body text,
  type text default 'info'::text,
  channel text default 'in_app'::text,
  is_read boolean default false,
  sent_at timestamp with time zone,
  read_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.payments (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  member_id uuid,
  plan_id uuid,
  amount numeric(12,2) not null,
  currency text default 'NGN'::text,
  paystack_reference text,
  payment_method text default 'card'::text,
  payment_date timestamp with time zone default now(),
  status text default 'pending'::text,
  metadata jsonb,
  created_at timestamp with time zone default now(),
  payment_status text default 'pending'::text,
  paystack_authorization_code text
);

create table if not exists public.platform_admins (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.platform_payments (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  amount numeric(12,2) not null default 20000.00,
  payment_status payment_status not null default 'pending'::payment_status,
  paystack_reference text,
  billing_period_start date not null,
  billing_period_end date not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  currency text default 'NGN'::text,
  plan text default 'starter'::text
);

create table if not exists public.profiles (
  id uuid not null,
  gym_id uuid,
  first_name text,
  last_name text,
  phone text,
  role text default 'member'::text,
  avatar_url text,
  waiver_signed_at timestamp with time zone,
  waiver_signature text,
  emergency_contact_name text,
  emergency_contact_phone text,
  health_notes text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  full_name text generated always as (COALESCE(NULLIF(TRIM(BOTH FROM ((COALESCE(first_name, ''::text) || ' '::text) || COALESCE(last_name, ''::text))), ''::text), NULL::text)) stored,
  email text,
  date_of_birth date,
  gender text,
  address text,
  nok_name text,
  nok_relationship text,
  nok_phone text,
  nok_address text,
  photo_url text,
  member_id text generated always as (upper(replace((id)::text, '-'::text, ''::text))) stored,
  user_id uuid,
  bio text,
  specialisation text,
  certifications text,
  notification_email boolean not null default true,
  notification_whatsapp boolean not null default true,
  availability jsonb
);

create table if not exists public.reminder_logs (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  action text not null,
  channel text not null default 'sms'::text,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  message_preview text,
  created_at timestamp with time zone default now()
);

create table if not exists public.reminders (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  type text not null,
  channel text not null,
  template text,
  schedule timestamp with time zone,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  days_before integer default 3
);

create table if not exists public.salary_payments (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  staff_link_id uuid not null,
  amount numeric(12,2) not null,
  payment_date date not null,
  payment_method text,
  payment_period text,
  notes text,
  paid_by uuid,
  created_at timestamp with time zone not null default now(),
  staff_id uuid,
  status text default 'paid'::text,
  period_start date,
  period_end date
);

create table if not exists public.saved_cards (
  id uuid not null default gen_random_uuid(),
  gym_id uuid not null,
  member_id uuid not null,
  authorization_code text not null,
  card_type text,
  last4 text,
  exp_month text,
  exp_year text,
  bank text,
  brand text,
  reusable boolean default true,
  email text,
  is_default boolean default false,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  expiry_month integer,
  expiry_year integer,
  paystack_authorization_code text
);

create table if not exists public.staff (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  user_id uuid,
  profile_id uuid,
  role text not null,
  salary numeric(12,2),
  hire_date date,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.support_tickets (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  subject text not null,
  body text,
  status text not null default 'open'::text,
  priority text not null default 'normal'::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.waiver_signatures (
  id uuid not null default gen_random_uuid(),
  waiver_id uuid,
  member_id uuid,
  signature text,
  signed_at timestamp with time zone default now(),
  ip_address text,
  user_agent text,
  gym_id uuid,
  signature_data text
);

create table if not exists public.waivers (
  id uuid not null default gen_random_uuid(),
  gym_id uuid,
  title text not null,
  content text not null,
  version text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ─── Constraints (primary keys, unique, check; then foreign keys) ────────────
do $$ begin if not exists (select 1 from pg_constraint where conname='audit_logs_pkey' and conrelid='public.audit_logs'::regclass) then alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='business_hours_day_of_week_check' and conrelid='public.business_hours'::regclass) then alter table public.business_hours add constraint business_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='business_hours_pkey' and conrelid='public.business_hours'::regclass) then alter table public.business_hours add constraint business_hours_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='business_hours_gym_id_day_of_week_key' and conrelid='public.business_hours'::regclass) then alter table public.business_hours add constraint business_hours_gym_id_day_of_week_key UNIQUE (gym_id, day_of_week); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='check_ins_status_check' and conrelid='public.check_ins'::regclass) then alter table public.check_ins add constraint check_ins_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'overstay'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='check_ins_pkey' and conrelid='public.check_ins'::regclass) then alter table public.check_ins add constraint check_ins_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_status_check' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'waitlisted'::text, 'attended'::text, 'cancelled'::text, 'no_show'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_pkey' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_gym_id_class_schedule_id_member_id_key' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_gym_id_class_schedule_id_member_id_key UNIQUE (gym_id, class_schedule_id, member_id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_schedules_day_of_week_check' and conrelid='public.class_schedules'::regclass) then alter table public.class_schedules add constraint class_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_schedules_pkey' and conrelid='public.class_schedules'::regclass) then alter table public.class_schedules add constraint class_schedules_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='classes_level_check' and conrelid='public.classes'::regclass) then alter table public.classes add constraint classes_level_check CHECK ((level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text, 'all'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='classes_pkey' and conrelid='public.classes'::regclass) then alter table public.classes add constraint classes_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='client_errors_severity_check' and conrelid='public.client_errors'::regclass) then alter table public.client_errors add constraint client_errors_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'fatal'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='client_errors_pkey' and conrelid='public.client_errors'::regclass) then alter table public.client_errors add constraint client_errors_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_status_check' and conrelid='public.equipment'::regclass) then alter table public.equipment add constraint equipment_status_check CHECK ((status = ANY (ARRAY['active'::text, 'maintenance'::text, 'retired'::text, 'lost'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_pkey' and conrelid='public.equipment'::regclass) then alter table public.equipment add constraint equipment_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_maintenance_maintenance_type_check' and conrelid='public.equipment_maintenance'::regclass) then alter table public.equipment_maintenance add constraint equipment_maintenance_maintenance_type_check CHECK ((maintenance_type = ANY (ARRAY['routine'::text, 'repair'::text, 'inspection'::text, 'replacement'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_maintenance_status_check' and conrelid='public.equipment_maintenance'::regclass) then alter table public.equipment_maintenance add constraint equipment_maintenance_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_maintenance_pkey' and conrelid='public.equipment_maintenance'::regclass) then alter table public.equipment_maintenance add constraint equipment_maintenance_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='expenses_recurring_frequency_check' and conrelid='public.expenses'::regclass) then alter table public.expenses add constraint expenses_recurring_frequency_check CHECK ((recurring_frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='expenses_pkey' and conrelid='public.expenses'::regclass) then alter table public.expenses add constraint expenses_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='export_logs_pkey' and conrelid='public.export_logs'::regclass) then alter table public.export_logs add constraint export_logs_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_member_links_pkey' and conrelid='public.gym_member_links'::regclass) then alter table public.gym_member_links add constraint gym_member_links_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_member_links_gym_id_user_id_key' and conrelid='public.gym_member_links'::regclass) then alter table public.gym_member_links add constraint gym_member_links_gym_id_user_id_key UNIQUE (gym_id, user_id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_staff_links_role_check' and conrelid='public.gym_staff_links'::regclass) then alter table public.gym_staff_links add constraint gym_staff_links_role_check CHECK ((role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role, 'instructor'::user_role]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_staff_links_pkey' and conrelid='public.gym_staff_links'::regclass) then alter table public.gym_staff_links add constraint gym_staff_links_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_staff_links_gym_id_user_id_role_key' and conrelid='public.gym_staff_links'::regclass) then alter table public.gym_staff_links add constraint gym_staff_links_gym_id_user_id_role_key UNIQUE (gym_id, user_id, role); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_instructor_revenue_share_pct_check' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_instructor_revenue_share_pct_check CHECK (((instructor_revenue_share_pct >= 0) AND (instructor_revenue_share_pct <= 100))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_platform_commission_pct_check' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_platform_commission_pct_check CHECK (((platform_commission_pct >= (0)::numeric) AND (platform_commission_pct <= (100)::numeric))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_status_check' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_subscription_status_check' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'cancelled'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_pkey' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gyms_slug_key' and conrelid='public.gyms'::regclass) then alter table public.gyms add constraint gyms_slug_key UNIQUE (slug); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_bank_details_pkey' and conrelid='public.instructor_bank_details'::regclass) then alter table public.instructor_bank_details add constraint instructor_bank_details_pkey PRIMARY KEY (instructor_id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_amount_check' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_amount_check CHECK ((amount > (0)::numeric)); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_status_check' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'paid'::text, 'rejected'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_pkey' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_pricing_pkey' and conrelid='public.instructor_pricing'::regclass) then alter table public.instructor_pricing add constraint instructor_pricing_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_sessions_status_check' and conrelid='public.instructor_sessions'::regclass) then alter table public.instructor_sessions add constraint instructor_sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_sessions_pkey' and conrelid='public.instructor_sessions'::regclass) then alter table public.instructor_sessions add constraint instructor_sessions_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_status_check' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_pkey' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='member_subscriptions_status_check' and conrelid='public.member_subscriptions'::regclass) then alter table public.member_subscriptions add constraint member_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='member_subscriptions_pkey' and conrelid='public.member_subscriptions'::regclass) then alter table public.member_subscriptions add constraint member_subscriptions_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='membership_plans_pkey' and conrelid='public.membership_plans'::regclass) then alter table public.membership_plans add constraint membership_plans_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='memberships_status_check' and conrelid='public.memberships'::regclass) then alter table public.memberships add constraint memberships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='memberships_pkey' and conrelid='public.memberships'::regclass) then alter table public.memberships add constraint memberships_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='notifications_channel_check' and conrelid='public.notifications'::regclass) then alter table public.notifications add constraint notifications_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text, 'sms'::text, 'whatsapp'::text, 'push'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='notifications_type_check' and conrelid='public.notifications'::regclass) then alter table public.notifications add constraint notifications_type_check CHECK ((type = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'success'::text, 'payment'::text, 'checkin'::text, 'class'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='notifications_pkey' and conrelid='public.notifications'::regclass) then alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_payment_method_check' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['card'::text, 'bank_transfer'::text, 'cash'::text, 'crypto'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_payment_status_check' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'successful'::text, 'failed'::text, 'refunded'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_status_check' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text, 'refunded'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_pkey' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_paystack_reference_key' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_paystack_reference_key UNIQUE (paystack_reference); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='platform_admins_pkey' and conrelid='public.platform_admins'::regclass) then alter table public.platform_admins add constraint platform_admins_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='platform_admins_email_key' and conrelid='public.platform_admins'::regclass) then alter table public.platform_admins add constraint platform_admins_email_key UNIQUE (email); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='platform_payments_pkey' and conrelid='public.platform_payments'::regclass) then alter table public.platform_payments add constraint platform_payments_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='platform_payments_paystack_reference_key' and conrelid='public.platform_payments'::regclass) then alter table public.platform_payments add constraint platform_payments_paystack_reference_key UNIQUE (paystack_reference); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_gender_check' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'prefer_not_to_say'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_role_check' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'instructor'::text, 'member'::text, 'platform_admin'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_pkey' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='reminder_logs_pkey' and conrelid='public.reminder_logs'::regclass) then alter table public.reminder_logs add constraint reminder_logs_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='reminders_channel_check' and conrelid='public.reminders'::regclass) then alter table public.reminders add constraint reminders_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'whatsapp'::text, 'email'::text, 'push'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='reminders_type_check' and conrelid='public.reminders'::regclass) then alter table public.reminders add constraint reminders_type_check CHECK ((type = ANY (ARRAY['membership_expiring'::text, 'payment_due'::text, 'class_reminder'::text, 'birthday'::text, 'custom'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='reminders_pkey' and conrelid='public.reminders'::regclass) then alter table public.reminders add constraint reminders_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='salary_payments_payment_method_check' and conrelid='public.salary_payments'::regclass) then alter table public.salary_payments add constraint salary_payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'other'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='salary_payments_pkey' and conrelid='public.salary_payments'::regclass) then alter table public.salary_payments add constraint salary_payments_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='saved_cards_pkey' and conrelid='public.saved_cards'::regclass) then alter table public.saved_cards add constraint saved_cards_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='saved_cards_member_id_authorization_code_key' and conrelid='public.saved_cards'::regclass) then alter table public.saved_cards add constraint saved_cards_member_id_authorization_code_key UNIQUE (member_id, authorization_code); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='staff_role_check' and conrelid='public.staff'::regclass) then alter table public.staff add constraint staff_role_check CHECK ((role = ANY (ARRAY['manager'::text, 'instructor'::text, 'receptionist'::text, 'maintenance'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='staff_pkey' and conrelid='public.staff'::regclass) then alter table public.staff add constraint staff_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='support_tickets_pkey' and conrelid='public.support_tickets'::regclass) then alter table public.support_tickets add constraint support_tickets_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waiver_signatures_pkey' and conrelid='public.waiver_signatures'::regclass) then alter table public.waiver_signatures add constraint waiver_signatures_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waivers_pkey' and conrelid='public.waivers'::regclass) then alter table public.waivers add constraint waivers_pkey PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='audit_logs_user_id_fkey' and conrelid='public.audit_logs'::regclass) then alter table public.audit_logs add constraint audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='business_hours_gym_id_fkey' and conrelid='public.business_hours'::regclass) then alter table public.business_hours add constraint business_hours_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='check_ins_gym_id_fkey' and conrelid='public.check_ins'::regclass) then alter table public.check_ins add constraint check_ins_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='check_ins_member_id_fkey' and conrelid='public.check_ins'::regclass) then alter table public.check_ins add constraint check_ins_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_class_id_fkey' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_class_schedule_id_fkey' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_class_schedule_id_fkey FOREIGN KEY (class_schedule_id) REFERENCES class_schedules(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_gym_id_fkey' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_bookings_member_id_fkey' and conrelid='public.class_bookings'::regclass) then alter table public.class_bookings add constraint class_bookings_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_schedules_class_id_fkey' and conrelid='public.class_schedules'::regclass) then alter table public.class_schedules add constraint class_schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_schedules_gym_id_fkey' and conrelid='public.class_schedules'::regclass) then alter table public.class_schedules add constraint class_schedules_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='class_schedules_instructor_id_fkey' and conrelid='public.class_schedules'::regclass) then alter table public.class_schedules add constraint class_schedules_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='classes_gym_id_fkey' and conrelid='public.classes'::regclass) then alter table public.classes add constraint classes_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='classes_instructor_id_fkey' and conrelid='public.classes'::regclass) then alter table public.classes add constraint classes_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='client_errors_gym_id_fkey' and conrelid='public.client_errors'::regclass) then alter table public.client_errors add constraint client_errors_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='client_errors_user_id_fkey' and conrelid='public.client_errors'::regclass) then alter table public.client_errors add constraint client_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_gym_id_fkey' and conrelid='public.equipment'::regclass) then alter table public.equipment add constraint equipment_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_maintenance_equipment_id_fkey' and conrelid='public.equipment_maintenance'::regclass) then alter table public.equipment_maintenance add constraint equipment_maintenance_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='equipment_maintenance_gym_id_fkey' and conrelid='public.equipment_maintenance'::regclass) then alter table public.equipment_maintenance add constraint equipment_maintenance_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='expenses_created_by_fkey' and conrelid='public.expenses'::regclass) then alter table public.expenses add constraint expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='expenses_gym_id_fkey' and conrelid='public.expenses'::regclass) then alter table public.expenses add constraint expenses_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_member_links_gym_id_fkey' and conrelid='public.gym_member_links'::regclass) then alter table public.gym_member_links add constraint gym_member_links_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_member_links_member_id_fkey' and conrelid='public.gym_member_links'::regclass) then alter table public.gym_member_links add constraint gym_member_links_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_member_links_user_id_fkey' and conrelid='public.gym_member_links'::regclass) then alter table public.gym_member_links add constraint gym_member_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_staff_links_gym_id_fkey' and conrelid='public.gym_staff_links'::regclass) then alter table public.gym_staff_links add constraint gym_staff_links_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='gym_staff_links_user_id_fkey' and conrelid='public.gym_staff_links'::regclass) then alter table public.gym_staff_links add constraint gym_staff_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_bank_details_instructor_id_fkey' and conrelid='public.instructor_bank_details'::regclass) then alter table public.instructor_bank_details add constraint instructor_bank_details_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_gym_id_fkey' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_instructor_id_fkey' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_payouts_processed_by_fkey' and conrelid='public.instructor_payouts'::regclass) then alter table public.instructor_payouts add constraint instructor_payouts_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES profiles(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_sessions_gym_id_fkey' and conrelid='public.instructor_sessions'::regclass) then alter table public.instructor_sessions add constraint instructor_sessions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_sessions_instructor_id_fkey' and conrelid='public.instructor_sessions'::regclass) then alter table public.instructor_sessions add constraint instructor_sessions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_sessions_member_id_fkey' and conrelid='public.instructor_sessions'::regclass) then alter table public.instructor_sessions add constraint instructor_sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_gym_id_fkey' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_instructor_id_fkey' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_member_id_fkey' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='instructor_subscriptions_plan_id_fkey' and conrelid='public.instructor_subscriptions'::regclass) then alter table public.instructor_subscriptions add constraint instructor_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='member_subscriptions_gym_id_fkey' and conrelid='public.member_subscriptions'::regclass) then alter table public.member_subscriptions add constraint member_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='member_subscriptions_member_id_fkey' and conrelid='public.member_subscriptions'::regclass) then alter table public.member_subscriptions add constraint member_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='member_subscriptions_plan_id_fkey' and conrelid='public.member_subscriptions'::regclass) then alter table public.member_subscriptions add constraint member_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='membership_plans_gym_id_fkey' and conrelid='public.membership_plans'::regclass) then alter table public.membership_plans add constraint membership_plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='memberships_gym_id_fkey' and conrelid='public.memberships'::regclass) then alter table public.memberships add constraint memberships_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='memberships_member_id_fkey' and conrelid='public.memberships'::regclass) then alter table public.memberships add constraint memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='memberships_plan_id_fkey' and conrelid='public.memberships'::regclass) then alter table public.memberships add constraint memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='notifications_gym_id_fkey' and conrelid='public.notifications'::regclass) then alter table public.notifications add constraint notifications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='notifications_user_id_fkey' and conrelid='public.notifications'::regclass) then alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_gym_id_fkey' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_member_id_fkey' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='payments_plan_id_fkey' and conrelid='public.payments'::regclass) then alter table public.payments add constraint payments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='platform_admins_user_id_fkey' and conrelid='public.platform_admins'::regclass) then alter table public.platform_admins add constraint platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_gym_id_fkey' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_id_fkey' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='profiles_user_id_fkey' and conrelid='public.profiles'::regclass) then alter table public.profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='reminders_gym_id_fkey' and conrelid='public.reminders'::regclass) then alter table public.reminders add constraint reminders_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='salary_payments_staff_id_fkey' and conrelid='public.salary_payments'::regclass) then alter table public.salary_payments add constraint salary_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='salary_payments_staff_link_id_fkey' and conrelid='public.salary_payments'::regclass) then alter table public.salary_payments add constraint salary_payments_staff_link_id_fkey FOREIGN KEY (staff_link_id) REFERENCES gym_staff_links(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='saved_cards_gym_id_fkey' and conrelid='public.saved_cards'::regclass) then alter table public.saved_cards add constraint saved_cards_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='saved_cards_member_id_fkey' and conrelid='public.saved_cards'::regclass) then alter table public.saved_cards add constraint saved_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='staff_gym_id_fkey' and conrelid='public.staff'::regclass) then alter table public.staff add constraint staff_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='staff_profile_id_fkey' and conrelid='public.staff'::regclass) then alter table public.staff add constraint staff_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='staff_user_id_fkey' and conrelid='public.staff'::regclass) then alter table public.staff add constraint staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='support_tickets_created_by_fkey' and conrelid='public.support_tickets'::regclass) then alter table public.support_tickets add constraint support_tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='support_tickets_gym_id_fkey' and conrelid='public.support_tickets'::regclass) then alter table public.support_tickets add constraint support_tickets_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waiver_signatures_gym_id_fkey' and conrelid='public.waiver_signatures'::regclass) then alter table public.waiver_signatures add constraint waiver_signatures_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waiver_signatures_member_id_fkey' and conrelid='public.waiver_signatures'::regclass) then alter table public.waiver_signatures add constraint waiver_signatures_member_id_fkey FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waiver_signatures_waiver_id_fkey' and conrelid='public.waiver_signatures'::regclass) then alter table public.waiver_signatures add constraint waiver_signatures_waiver_id_fkey FOREIGN KEY (waiver_id) REFERENCES waivers(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='waivers_gym_id_fkey' and conrelid='public.waivers'::regclass) then alter table public.waivers add constraint waivers_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE; end if; end $$;

-- ─── Indexes (non-constraint) ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_gym_id ON public.audit_logs USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs USING btree (table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_business_hours_gym ON public.business_hours USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_checkins_datetime ON public.check_ins USING btree (gym_id, checked_in_at);
CREATE INDEX IF NOT EXISTS idx_checkins_gym ON public.check_ins USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_checkins_member ON public.check_ins USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_checkins_member_gym_time ON public.check_ins USING btree (member_id, gym_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_member ON public.class_bookings USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON public.class_bookings USING btree (class_schedule_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_class_date ON public.class_bookings USING btree (class_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_class_bookings_member ON public.class_bookings USING btree (member_id, status);
CREATE INDEX IF NOT EXISTS idx_class_bookings_promote ON public.class_bookings USING btree (class_schedule_id, booking_date, status, booked_at);
CREATE INDEX IF NOT EXISTS idx_class_bookings_schedule_date_status ON public.class_bookings USING btree (class_schedule_id, booking_date, status);
CREATE INDEX IF NOT EXISTS idx_class_schedules_gym_id ON public.class_schedules USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_instructor_id ON public.class_schedules USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS idx_schedules_class ON public.class_schedules USING btree (class_id);
CREATE INDEX IF NOT EXISTS idx_schedules_day ON public.class_schedules USING btree (day_of_week);
CREATE INDEX IF NOT EXISTS idx_classes_gym ON public.classes USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_classes_gym_day ON public.classes USING btree (gym_id, day_of_week, is_active);
CREATE INDEX IF NOT EXISTS idx_classes_instructor ON public.classes USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS idx_client_errors_gym_id ON public.client_errors USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_client_errors_user_id ON public.client_errors USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_gym ON public.equipment USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment USING btree (status);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_equipment ON public.equipment_maintenance USING btree (equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_gym_id ON public.equipment_maintenance USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses USING btree (expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_gym ON public.expenses USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_expenses_recurring ON public.expenses USING btree (gym_id, is_recurring) WHERE (is_recurring = true);
CREATE INDEX IF NOT EXISTS idx_gym_member_links_member_id ON public.gym_member_links USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_gym_member_links_user_id ON public.gym_member_links USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_gym_id ON public.gym_staff_links USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_gym_user_active ON public.gym_staff_links USING btree (gym_id, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_instructor ON public.gym_staff_links USING btree (gym_id, user_id) WHERE ((role = 'instructor'::user_role) AND (is_active = true));
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_user_id ON public.gym_staff_links USING btree (user_id);
CREATE INDEX IF NOT EXISTS gyms_paystack_customer_code_idx ON public.gyms USING btree (paystack_customer_code) WHERE (paystack_customer_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS gyms_paystack_subscription_code_idx ON public.gyms USING btree (paystack_subscription_code) WHERE (paystack_subscription_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gyms_paystack_subaccount ON public.gyms USING btree (paystack_subaccount_code) WHERE (paystack_subaccount_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gyms_renewal_window ON public.gyms USING btree (subscription_status, trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_gym_status ON public.instructor_payouts USING btree (gym_id, status);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_instructor ON public.instructor_payouts USING btree (instructor_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_processed_by ON public.instructor_payouts USING btree (processed_by);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_transfer_code ON public.instructor_payouts USING btree (paystack_transfer_code) WHERE (paystack_transfer_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_gym ON public.instructor_sessions USING btree (gym_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_instructor_time ON public.instructor_sessions USING btree (instructor_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_member_time ON public.instructor_sessions USING btree (member_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_subs_member_instructor_status ON public.instructor_subscriptions USING btree (member_id, instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_instructor ON public.instructor_subscriptions USING btree (instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_member ON public.instructor_subscriptions USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_plan ON public.instructor_subscriptions USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_renewal ON public.instructor_subscriptions USING btree (gym_id, end_date) WHERE ((status = 'active'::text) AND (auto_renew = true));
CREATE INDEX IF NOT EXISTS idx_member_subs_gym_id ON public.member_subscriptions USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_member_subs_member_id ON public.member_subscriptions USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_member_subs_plan_id ON public.member_subscriptions USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_membership_plans_gym_id ON public.membership_plans USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_auto_debit_due ON public.memberships USING btree (end_date) WHERE ((status = 'active'::text) AND (auto_debit_enabled = true));
CREATE INDEX IF NOT EXISTS idx_memberships_end_date ON public.memberships USING btree (end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_gym ON public.memberships USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON public.memberships USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member_gym_status ON public.memberships USING btree (member_id, gym_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_plan_id ON public.memberships USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON public.memberships USING btree (status);
CREATE INDEX IF NOT EXISTS idx_memberships_status_end_date ON public.memberships USING btree (status, end_date);
CREATE INDEX IF NOT EXISTS idx_notifications_gym_id ON public.notifications USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments USING btree (gym_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_gym ON public.payments USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_payments_gym_status_date ON public.payments USING btree (gym_id, payment_status, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON public.payments USING btree (member_id, gym_id, payment_date) WHERE ((payment_method = 'card'::text) AND (payment_status = 'successful'::text));
CREATE INDEX IF NOT EXISTS idx_payments_member ON public.payments USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan_id ON public.payments USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments USING btree (status);
CREATE INDEX IF NOT EXISTS idx_platform_admins_user_id ON public.platform_admins USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS platform_payments_reference_unique ON public.platform_payments USING btree (paystack_reference) WHERE (paystack_reference IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles USING btree (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_gym ON public.profiles USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles USING btree (role);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_created ON public.reminder_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_gym_action ON public.reminder_logs USING btree (gym_id, action);
CREATE INDEX IF NOT EXISTS idx_reminders_gym ON public.reminders USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_reminders_type ON public.reminders USING btree (type);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff_id ON public.salary_payments USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff_link_id ON public.salary_payments USING btree (staff_link_id);
CREATE INDEX IF NOT EXISTS idx_saved_cards_active ON public.saved_cards USING btree (gym_id, member_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_staff_gym ON public.staff USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_staff_profile_id ON public.staff USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON public.staff USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_gym_id ON public.waiver_signatures USING btree (gym_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_member_id ON public.waiver_signatures USING btree (member_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_waiver_id ON public.waiver_signatures USING btree (waiver_id);
CREATE INDEX IF NOT EXISTS idx_waivers_gym ON public.waivers USING btree (gym_id);

-- ─── Functions ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_see_profile(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_member_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_staff_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
        AND them.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    );
$function$
;

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  expired_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE memberships SET status = 'expired', updated_at = now()
    WHERE status = 'active' AND end_date < CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO expired_count FROM updated;

  -- Mirror to member_subscriptions
  UPDATE member_subscriptions SET status = 'expired', updated_at = now()
  WHERE status = 'active' AND end_date < CURRENT_DATE;

  RETURN expired_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_gym_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT gym_id FROM profiles WHERE user_id = auth.uid() LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_profile_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  pid UUID;
BEGIN
  SELECT id INTO pid FROM profiles WHERE id = auth.uid() LIMIT 1;
  RETURN pid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_gyms()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT gym_id FROM gym_member_links WHERE user_id = auth.uid();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gym_id_from_waiver(_waiver_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT gym_id FROM waivers WHERE id = _waiver_id LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  full_name_val text := COALESCE(meta->>'full_name', '');
  first_name_val text;
  last_name_val text;
  gym_slug_val text := NULLIF(meta->>'signup_gym_slug', '');
  gym_row record;
  active_waiver_id uuid;
BEGIN
  first_name_val := COALESCE(meta->>'first_name', split_part(full_name_val, ' ', 1));
  last_name_val := COALESCE(
    meta->>'last_name',
    NULLIF(substring(full_name_val FROM position(' ' IN full_name_val || ' ') + 1), '')
  );

  INSERT INTO public.profiles (
    id, email,
    first_name, last_name,
    phone,
    date_of_birth, gender, address,
    nok_name, nok_relationship, nok_phone, nok_address,
    health_notes,
    waiver_signed_at,
    role,
    is_active,
    created_at
  )
  VALUES (
    NEW.id, NEW.email,
    first_name_val, last_name_val,
    NULLIF(meta->>'phone', ''),
    NULLIF(meta->>'date_of_birth', '')::date,
    NULLIF(meta->>'gender', ''),
    NULLIF(meta->>'address', ''),
    NULLIF(meta->>'nok_name', ''),
    NULLIF(meta->>'nok_relationship', ''),
    NULLIF(meta->>'nok_phone', ''),
    NULLIF(meta->>'nok_address', ''),
    NULLIF(meta->>'health_notes', ''),
    CASE WHEN (meta->>'waiver_signed') IN ('true','on','1') THEN now() ELSE NULL END,
    'member',
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name),
    phone      = COALESCE(EXCLUDED.phone,      public.profiles.phone),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
    gender     = COALESCE(EXCLUDED.gender,     public.profiles.gender),
    address    = COALESCE(EXCLUDED.address,    public.profiles.address),
    nok_name   = COALESCE(EXCLUDED.nok_name,   public.profiles.nok_name),
    nok_relationship = COALESCE(EXCLUDED.nok_relationship, public.profiles.nok_relationship),
    nok_phone  = COALESCE(EXCLUDED.nok_phone,  public.profiles.nok_phone),
    nok_address = COALESCE(EXCLUDED.nok_address, public.profiles.nok_address),
    health_notes = COALESCE(EXCLUDED.health_notes, public.profiles.health_notes),
    waiver_signed_at = COALESCE(public.profiles.waiver_signed_at, EXCLUDED.waiver_signed_at);

  IF gym_slug_val IS NOT NULL THEN
    SELECT id INTO gym_row FROM public.gyms WHERE slug = gym_slug_val LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.gym_member_links (gym_id, user_id, member_id, onboarding_method, is_active, joined_at, status)
      VALUES (gym_row.id, NEW.id, NEW.id, 'self_signup', true, now(), 'active')
      ON CONFLICT DO NOTHING;

      IF (meta->>'waiver_signed') IN ('true','on','1') THEN
        SELECT id INTO active_waiver_id
        FROM public.waivers
        WHERE gym_id = gym_row.id AND is_active = true
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1;

        IF active_waiver_id IS NOT NULL THEN
          INSERT INTO public.waiver_signatures (gym_id, waiver_id, member_id, signed_at, signature)
          VALUES (gym_row.id, active_waiver_id, NEW.id, now(), COALESCE(NULLIF(meta->>'waiver_signature', ''), 'electronic'))
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_gym_role(p_gym_id uuid, p_roles user_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM gym_staff_links
    WHERE gym_id = p_gym_id
    AND user_id = auth.uid()
    AND role = ANY(p_roles)
    AND is_active = TRUE
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_gym_member(_gym_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM gym_member_links
    WHERE user_id = auth.uid() AND gym_id = _gym_id
  ) OR EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND gym_id = _gym_id AND is_active = true
  ) OR is_platform_admin()
$function$
;

CREATE OR REPLACE FUNCTION public.is_gym_owner(_gym_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND gym_id = _gym_id
      AND role IN ('owner', 'manager') AND is_active = true
  ) OR is_platform_admin()
$function$
;

CREATE OR REPLACE FUNCTION public.is_gym_staff(_gym_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND gym_id = _gym_id
      AND role IN ('owner', 'manager', 'staff', 'instructor') AND is_active = true
  ) OR is_platform_admin()
$function$
;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles
             WHERE id = auth.uid()
               AND role = 'platform_admin'
               AND COALESCE(is_active, true) = true)
    OR EXISTS (SELECT 1 FROM public.platform_admins
                WHERE user_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.log_payment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO audit_logs (gym_id, user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    COALESCE(NEW.gym_id, OLD.gym_id),
    auth.uid(),
    LOWER(TG_OP) || '.payment',
    'payments',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_memberships_to_subs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Guard: skip if we're already inside a sync to avoid infinite recursion
  IF current_setting('app.syncing_memberships', true) = 'true' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.syncing_memberships', 'true', true);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO member_subscriptions (
      id, gym_id, member_id, plan_id, start_date, end_date,
      status, auto_debit_enabled, payment_method, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.gym_id, NEW.member_id, NEW.plan_id, NEW.start_date, NEW.end_date,
      NEW.status, COALESCE(NEW.auto_debit_enabled, false), COALESCE(NEW.payment_method,'card'),
      NEW.created_at, NEW.updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      end_date = EXCLUDED.end_date,
      updated_at = now();

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE member_subscriptions SET
      status = NEW.status,
      end_date = NEW.end_date,
      plan_id = NEW.plan_id,
      auto_debit_enabled = COALESCE(NEW.auto_debit_enabled, false),
      updated_at = now()
    WHERE id = NEW.id;
  END IF;

  PERFORM set_config('app.syncing_memberships', 'false', true);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- status → payment_status
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.payment_status = CASE NEW.status
      WHEN 'success'  THEN 'successful'
      WHEN 'failed'   THEN 'failed'
      WHEN 'refunded' THEN 'refunded'
      ELSE 'pending'
    END;
  END IF;
  -- payment_status → status
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    NEW.status = CASE NEW.payment_status
      WHEN 'successful' THEN 'success'
      WHEN 'failed'     THEN 'failed'
      WHEN 'refunded'   THEN 'refunded'
      ELSE 'pending'
    END;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_derived_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- full_name: keep in sync with first_name + last_name
  IF NEW.full_name IS NULL OR NEW.full_name = '' THEN
    NEW.full_name := NULLIF(
      TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')),
      ''
    );
  END IF;

  -- Reverse: if full_name was provided but first/last weren't, split it
  IF NEW.full_name IS NOT NULL
     AND NEW.first_name IS NULL AND NEW.last_name IS NULL THEN
    NEW.first_name := SPLIT_PART(NEW.full_name, ' ', 1);
    NEW.last_name  := NULLIF(
      TRIM(SUBSTR(NEW.full_name, LENGTH(SPLIT_PART(NEW.full_name,' ',1)) + 2)),
      ''
    );
  END IF;

  -- member_id: readable hex from UUID (always overwrite to keep it consistent)
  NEW.member_id := UPPER(REPLACE(NEW.id::TEXT, '-', ''));

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_subs_to_memberships()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF current_setting('app.syncing_memberships', true) = 'true' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.syncing_memberships', 'true', true);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO memberships (
      id, gym_id, member_id, plan_id, start_date, end_date,
      status, auto_debit_enabled, payment_method, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.gym_id, NEW.member_id, NEW.plan_id, NEW.start_date, NEW.end_date,
      NEW.status, COALESCE(NEW.auto_debit_enabled, false), COALESCE(NEW.payment_method,'card'),
      NEW.created_at, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      end_date = EXCLUDED.end_date,
      updated_at = now();

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE memberships SET
      status = NEW.status,
      end_date = NEW.end_date,
      plan_id = NEW.plan_id,
      updated_at = now()
    WHERE id = NEW.id;
  END IF;

  PERFORM set_config('app.syncing_memberships', 'false', true);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_waivers_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

-- Lock down SECURITY DEFINER helpers with no PUBLIC EXECUTE on the live project
-- (matches migration 20260626 plus the trigger/definer functions). Leaves
-- service_role + owner. can_see_profile/has_gym_role/is_gym_staff/is_platform_admin
-- deliberately keep PUBLIC EXECUTE — they are invoked inside RLS policies.
revoke execute on function public.expire_subscriptions() from public, anon, authenticated;
revoke execute on function public.get_current_gym_id() from public, anon, authenticated;
revoke execute on function public.get_my_profile_id() from public, anon, authenticated;
revoke execute on function public.get_user_gyms() from public, anon, authenticated;
revoke execute on function public.gym_id_from_waiver(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_gym_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_gym_owner(uuid) from public, anon, authenticated;
revoke execute on function public.log_payment_change() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.sync_memberships_to_subs() from public, anon, authenticated;
revoke execute on function public.sync_subs_to_memberships() from public, anon, authenticated;

-- ─── Row Level Security: enable ─────────────────────────────────────────────
alter table public.audit_logs enable row level security;
alter table public.business_hours enable row level security;
alter table public.check_ins enable row level security;
alter table public.class_bookings enable row level security;
alter table public.class_schedules enable row level security;
alter table public.classes enable row level security;
alter table public.client_errors enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_maintenance enable row level security;
alter table public.expenses enable row level security;
alter table public.export_logs enable row level security;
alter table public.gym_member_links enable row level security;
alter table public.gym_staff_links enable row level security;
alter table public.gyms enable row level security;
alter table public.instructor_bank_details enable row level security;
alter table public.instructor_payouts enable row level security;
alter table public.instructor_pricing enable row level security;
alter table public.instructor_sessions enable row level security;
alter table public.instructor_subscriptions enable row level security;
alter table public.member_subscriptions enable row level security;
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.notifications enable row level security;
alter table public.payments enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_payments enable row level security;
alter table public.profiles enable row level security;
alter table public.reminder_logs enable row level security;
alter table public.reminders enable row level security;
alter table public.salary_payments enable row level security;
alter table public.saved_cards enable row level security;
alter table public.staff enable row level security;
alter table public.support_tickets enable row level security;
alter table public.waiver_signatures enable row level security;
alter table public.waivers enable row level security;

-- ─── Row Level Security: policies ───────────────────────────────────────────
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs as PERMISSIVE for INSERT to service_role
  with check (true);
drop policy if exists audit_logs_select_gym_owner on public.audit_logs;
create policy audit_logs_select_gym_owner on public.audit_logs as PERMISSIVE for SELECT to public
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role]));
drop policy if exists audit_logs_select_platform_admin on public.audit_logs;
create policy audit_logs_select_platform_admin on public.audit_logs as PERMISSIVE for SELECT to authenticated
  using (is_platform_admin());
drop policy if exists bh_delete_owner on public.business_hours;
create policy bh_delete_owner on public.business_hours as PERMISSIVE for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists bh_insert_owner on public.business_hours;
create policy bh_insert_owner on public.business_hours as PERMISSIVE for INSERT to public
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists bh_select on public.business_hours;
create policy bh_select on public.business_hours as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = business_hours.gym_id)))));
drop policy if exists bh_update_owner on public.business_hours;
create policy bh_update_owner on public.business_hours as PERMISSIVE for UPDATE to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists checkins_insert_self on public.check_ins;
create policy checkins_insert_self on public.check_ins as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists checkins_insert_staff on public.check_ins;
create policy checkins_insert_staff on public.check_ins as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists checkins_select_scoped on public.check_ins;
create policy checkins_select_scoped on public.check_ins as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = check_ins.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))) OR is_platform_admin()));
drop policy if exists checkins_update_staff on public.check_ins;
create policy checkins_update_staff on public.check_ins as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists bookings_member_insert on public.class_bookings;
create policy bookings_member_insert on public.class_bookings as PERMISSIVE for INSERT to authenticated
  with check (((member_id = ( SELECT auth.uid() AS uid)) AND (gym_id IN ( SELECT gym_member_links.gym_id
   FROM gym_member_links
  WHERE (gym_member_links.user_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists bookings_instructor_select on public.class_bookings;
create policy bookings_instructor_select on public.class_bookings as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM class_schedules cs
  WHERE ((cs.id = class_bookings.class_schedule_id) AND (cs.instructor_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists bookings_member_select on public.class_bookings;
create policy bookings_member_select on public.class_bookings as PERMISSIVE for SELECT to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists bookings_staff_select on public.class_bookings;
create policy bookings_staff_select on public.class_bookings as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = class_bookings.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists bookings_instructor_update on public.class_bookings;
create policy bookings_instructor_update on public.class_bookings as PERMISSIVE for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM class_schedules cs
  WHERE ((cs.id = class_bookings.class_schedule_id) AND (cs.instructor_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists bookings_member_update_own on public.class_bookings;
create policy bookings_member_update_own on public.class_bookings as PERMISSIVE for UPDATE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists bookings_staff_update on public.class_bookings;
create policy bookings_staff_update on public.class_bookings as PERMISSIVE for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = class_bookings.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists schedules_insert_staff on public.class_schedules;
create policy schedules_insert_staff on public.class_schedules as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists schedules_select on public.class_schedules;
create policy schedules_select on public.class_schedules as PERMISSIVE for SELECT to authenticated
  using (true);
drop policy if exists schedules_update_staff on public.class_schedules;
create policy schedules_update_staff on public.class_schedules as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists classes_insert_staff on public.classes;
create policy classes_insert_staff on public.classes as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists classes_member_view on public.classes;
create policy classes_member_view on public.classes as PERMISSIVE for SELECT to authenticated
  using (((gym_id IN ( SELECT gym_member_links.gym_id
   FROM gym_member_links
  WHERE (gym_member_links.user_id = ( SELECT auth.uid() AS uid)))) AND (is_active = true)));
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes as PERMISSIVE for SELECT to authenticated
  using (true);
drop policy if exists classes_update_staff on public.classes;
create policy classes_update_staff on public.classes as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_select_admin on public.client_errors as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text, 'platform_admin'::text]))))));
drop policy if exists equipment_staff_write on public.equipment;
create policy equipment_staff_write on public.equipment as PERMISSIVE for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = equipment.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))))
  with check ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = equipment.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists equipment_select_staff on public.equipment;
create policy equipment_select_staff on public.equipment as PERMISSIVE for SELECT to authenticated
  using (((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = equipment.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))) OR is_platform_admin()));
drop policy if exists equipment_maintenance_gym on public.equipment_maintenance;
create policy equipment_maintenance_gym on public.equipment_maintenance as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.gym_id = equipment_maintenance.gym_id)))));
drop policy if exists expenses_staff_all on public.expenses;
create policy expenses_staff_all on public.expenses as PERMISSIVE for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = expenses.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))))
  with check ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = expenses.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists export_logs_select_staff on public.export_logs;
create policy export_logs_select_staff on public.export_logs as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links
  WHERE ((gym_staff_links.gym_id = export_logs.gym_id) AND (gym_staff_links.user_id = ( SELECT auth.uid() AS uid)) AND (gym_staff_links.is_active = true)))));
drop policy if exists gml_insert_self on public.gym_member_links;
create policy gml_insert_self on public.gym_member_links as PERMISSIVE for INSERT to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
drop policy if exists gml_insert_staff on public.gym_member_links;
create policy gml_insert_staff on public.gym_member_links as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists gml_select on public.gym_member_links;
create policy gml_select on public.gym_member_links as PERMISSIVE for SELECT to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.user_id = ( SELECT auth.uid() AS uid)) AND (s.gym_id = gym_member_links.gym_id)))) OR is_platform_admin()));
drop policy if exists gml_update_staff on public.gym_member_links;
create policy gml_update_staff on public.gym_member_links as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists gym_staff_links_all on public.gym_staff_links;
create policy gym_staff_links_all on public.gym_staff_links as PERMISSIVE for ALL to public
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.gym_id = gym_staff_links.gym_id) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));
drop policy if exists gym_staff_links_select_manager on public.gym_staff_links;
create policy gym_staff_links_select_manager on public.gym_staff_links as PERMISSIVE for SELECT to public
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists gym_staff_links_select_own on public.gym_staff_links;
create policy gym_staff_links_select_own on public.gym_staff_links as PERMISSIVE for SELECT to public
  using ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists gyms_delete_owner_only on public.gyms;
create policy gyms_delete_owner_only on public.gyms as PERMISSIVE for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = gyms.id) AND (p.role = 'owner'::text)))));
drop policy if exists gyms_insert on public.gyms;
create policy gyms_insert on public.gyms as PERMISSIVE for INSERT to public
  with check ((( SELECT auth.role() AS role) = 'authenticated'::text));
drop policy if exists gyms_select on public.gyms;
create policy gyms_select on public.gyms as PERMISSIVE for SELECT to public
  using (true);
drop policy if exists gyms_update_owner_only on public.gyms;
create policy gyms_update_owner_only on public.gyms as PERMISSIVE for UPDATE to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = gyms.id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists ibd_self_insert on public.instructor_bank_details;
create policy ibd_self_insert on public.instructor_bank_details as PERMISSIVE for INSERT to public
  with check ((instructor_id = auth.uid()));
drop policy if exists instructor_bank_details_insert_own on public.instructor_bank_details;
create policy instructor_bank_details_insert_own on public.instructor_bank_details as PERMISSIVE for INSERT to authenticated
  with check ((instructor_id = ( SELECT auth.uid() AS uid)));
drop policy if exists ibd_self_select on public.instructor_bank_details;
create policy ibd_self_select on public.instructor_bank_details as PERMISSIVE for SELECT to public
  using ((instructor_id = auth.uid()));
drop policy if exists instructor_bank_details_select_own on public.instructor_bank_details;
create policy instructor_bank_details_select_own on public.instructor_bank_details as PERMISSIVE for SELECT to authenticated
  using ((instructor_id = ( SELECT auth.uid() AS uid)));
drop policy if exists ibd_self_update on public.instructor_bank_details;
create policy ibd_self_update on public.instructor_bank_details as PERMISSIVE for UPDATE to public
  using ((instructor_id = auth.uid()))
  with check ((instructor_id = auth.uid()));
drop policy if exists instructor_bank_details_update_own on public.instructor_bank_details;
create policy instructor_bank_details_update_own on public.instructor_bank_details as PERMISSIVE for UPDATE to authenticated
  using ((instructor_id = ( SELECT auth.uid() AS uid)))
  with check ((instructor_id = ( SELECT auth.uid() AS uid)));
drop policy if exists ipay_insert_instructor on public.instructor_payouts;
create policy ipay_insert_instructor on public.instructor_payouts as PERMISSIVE for INSERT to authenticated
  with check ((instructor_id = ( SELECT auth.uid() AS uid)));
drop policy if exists ipay_select on public.instructor_payouts;
create policy ipay_select on public.instructor_payouts as PERMISSIVE for SELECT to authenticated
  using (((instructor_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_payouts.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true))))));
drop policy if exists ipay_update_admin on public.instructor_payouts;
create policy ipay_update_admin on public.instructor_payouts as PERMISSIVE for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_payouts.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true)))));
drop policy if exists instructor_pricing_select_public on public.instructor_pricing;
create policy instructor_pricing_select_public on public.instructor_pricing as PERMISSIVE for SELECT to public
  using ((is_active = true));
drop policy if exists isess_insert_instructor on public.instructor_sessions;
create policy isess_insert_instructor on public.instructor_sessions as PERMISSIVE for INSERT to authenticated
  with check (((instructor_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_sessions.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.role = 'instructor'::user_role) AND (s.is_active = true))))));
drop policy if exists isess_select on public.instructor_sessions;
create policy isess_select on public.instructor_sessions as PERMISSIVE for SELECT to authenticated
  using (((instructor_id = ( SELECT auth.uid() AS uid)) OR (member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_sessions.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))))));
drop policy if exists isess_update_instructor on public.instructor_sessions;
create policy isess_update_instructor on public.instructor_sessions as PERMISSIVE for UPDATE to authenticated
  using ((instructor_id = ( SELECT auth.uid() AS uid)))
  with check ((instructor_id = ( SELECT auth.uid() AS uid)));
drop policy if exists is_insert_self on public.instructor_subscriptions;
create policy is_insert_self on public.instructor_subscriptions as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists is_select_self_or_gym on public.instructor_subscriptions;
create policy is_select_self_or_gym on public.instructor_subscriptions as PERMISSIVE for SELECT to authenticated
  using (((instructor_id = ( SELECT auth.uid() AS uid)) OR (member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_subscriptions.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))))));
drop policy if exists is_update_self_or_instructor on public.instructor_subscriptions;
create policy is_update_self_or_instructor on public.instructor_subscriptions as PERMISSIVE for UPDATE to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (instructor_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_subscriptions.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))))));
drop policy if exists msub_insert_staff on public.member_subscriptions;
create policy msub_insert_staff on public.member_subscriptions as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists msub_select_self_or_gym on public.member_subscriptions;
create policy msub_select_self_or_gym on public.member_subscriptions as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = member_subscriptions.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))))));
drop policy if exists msub_update_staff on public.member_subscriptions;
create policy msub_update_staff on public.member_subscriptions as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists plans_insert_staff on public.membership_plans;
create policy plans_insert_staff on public.membership_plans as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists plans_select on public.membership_plans;
create policy plans_select on public.membership_plans as PERMISSIVE for SELECT to authenticated
  using (true);
drop policy if exists plans_update_staff on public.membership_plans;
create policy plans_update_staff on public.membership_plans as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));
drop policy if exists memberships_select_scoped on public.memberships;
create policy memberships_select_scoped on public.memberships as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = memberships.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))) OR is_platform_admin()));
drop policy if exists notif_insert_self on public.notifications;
create policy notif_insert_self on public.notifications as PERMISSIVE for INSERT to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists notif_insert_staff on public.notifications;
create policy notif_insert_staff on public.notifications as PERMISSIVE for INSERT to authenticated
  with check (((gym_id IS NOT NULL) AND has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role])));
drop policy if exists notif_select_self_or_gym on public.notifications;
create policy notif_select_self_or_gym on public.notifications as PERMISSIVE for SELECT to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = notifications.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true))))));
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications as PERMISSIVE for UPDATE to public
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
drop policy if exists payments_insert_staff on public.payments;
create policy payments_insert_staff on public.payments as PERMISSIVE for INSERT to authenticated
  with check (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));
drop policy if exists payments_select_scoped on public.payments;
create policy payments_select_scoped on public.payments as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = payments.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))) OR is_platform_admin()));
drop policy if exists pa_select_self on public.platform_admins;
create policy pa_select_self on public.platform_admins as PERMISSIVE for SELECT to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists platform_payments_no_insert on public.platform_payments;
create policy platform_payments_no_insert on public.platform_payments as PERMISSIVE for INSERT to authenticated
  with check (false);
drop policy if exists pp_select_gym_or_admin on public.platform_payments;
create policy pp_select_gym_or_admin on public.platform_payments as PERMISSIVE for SELECT to authenticated
  using (((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = platform_payments.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.role = 'gym_owner'::user_role) AND (s.is_active = true)))) OR (EXISTS ( SELECT 1
   FROM platform_admins pa
  WHERE (pa.user_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists platform_payments_no_update on public.platform_payments;
create policy platform_payments_no_update on public.platform_payments as PERMISSIVE for UPDATE to authenticated
  using (false)
  with check (false);
drop policy if exists profiles_delete_none on public.profiles;
create policy profiles_delete_none on public.profiles as PERMISSIVE for DELETE to public
  using (false);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles as PERMISSIVE for INSERT to public
  with check ((( SELECT auth.uid() AS uid) = id));
drop policy if exists profiles_insert_staff on public.profiles;
create policy profiles_insert_staff on public.profiles as PERMISSIVE for INSERT to authenticated
  with check (((gym_id IS NOT NULL) AND (role = 'member'::text) AND has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role])));
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles as PERMISSIVE for SELECT to authenticated
  using (can_see_profile(id));
drop policy if exists profiles_update_no_escalation on public.profiles;
create policy profiles_update_no_escalation on public.profiles as PERMISSIVE for UPDATE to public
  using ((( SELECT auth.uid() AS uid) = id))
  with check (((( SELECT auth.uid() AS uid) = id) AND (NOT (role IS DISTINCT FROM ( SELECT p2.role
   FROM profiles p2
  WHERE (p2.id = ( SELECT auth.uid() AS uid)))))));
drop policy if exists reminder_logs_staff_insert on public.reminder_logs;
create policy reminder_logs_staff_insert on public.reminder_logs as PERMISSIVE for INSERT to public
  with check ((EXISTS ( SELECT 1
   FROM gym_staff_links l
  WHERE ((l.user_id = auth.uid()) AND (l.gym_id = reminder_logs.gym_id) AND COALESCE(l.is_active, true)))));
drop policy if exists reminder_logs_select_staff on public.reminder_logs;
create policy reminder_logs_select_staff on public.reminder_logs as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links
  WHERE ((gym_staff_links.gym_id = reminder_logs.gym_id) AND (gym_staff_links.user_id = ( SELECT auth.uid() AS uid)) AND (gym_staff_links.is_active = true)))));
drop policy if exists reminder_logs_staff_select on public.reminder_logs;
create policy reminder_logs_staff_select on public.reminder_logs as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links l
  WHERE ((l.user_id = auth.uid()) AND (l.gym_id = reminder_logs.gym_id) AND COALESCE(l.is_active, true)))));
drop policy if exists reminders_write_owner on public.reminders;
create policy reminders_write_owner on public.reminders as PERMISSIVE for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = reminders.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = reminders.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists reminders_select_staff on public.reminders;
create policy reminders_select_staff on public.reminders as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = reminders.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists salary_payments_owner on public.salary_payments;
create policy salary_payments_owner on public.salary_payments as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.gym_id = salary_payments.gym_id) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists cards_member_all on public.saved_cards;
create policy cards_member_all on public.saved_cards as PERMISSIVE for ALL to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists staff_write_owner on public.staff;
create policy staff_write_owner on public.staff as PERMISSIVE for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = staff.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.gym_id = staff.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));
drop policy if exists staff_select_scoped on public.staff;
create policy staff_select_scoped on public.staff as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = staff.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true)))));
drop policy if exists support_tickets_platform_all on public.support_tickets;
create policy support_tickets_platform_all on public.support_tickets as PERMISSIVE for ALL to public
  using (is_platform_admin())
  with check (is_platform_admin());
drop policy if exists support_tickets_staff_insert on public.support_tickets;
create policy support_tickets_staff_insert on public.support_tickets as PERMISSIVE for INSERT to public
  with check (((gym_id IS NOT NULL) AND is_gym_staff(gym_id)));
drop policy if exists support_tickets_staff_select on public.support_tickets;
create policy support_tickets_staff_select on public.support_tickets as PERMISSIVE for SELECT to public
  using (((gym_id IS NOT NULL) AND is_gym_staff(gym_id)));
drop policy if exists signatures_member_insert on public.waiver_signatures;
create policy signatures_member_insert on public.waiver_signatures as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));
drop policy if exists signatures_select_scoped on public.waiver_signatures;
create policy signatures_select_scoped on public.waiver_signatures as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = waiver_signatures.gym_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))))));
drop policy if exists waivers_select on public.waivers;
create policy waivers_select on public.waivers as PERMISSIVE for SELECT to authenticated
  using (true);

-- ─── Triggers (public tables) ───────────────────────────────────────────────
drop trigger if exists trg_classes_updated_at on public.classes;
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_equipment_updated_at on public.equipment;
CREATE TRIGGER trg_equipment_updated_at BEFORE UPDATE ON public.equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_gym_staff_links_updated_at on public.gym_staff_links;
CREATE TRIGGER trg_gym_staff_links_updated_at BEFORE UPDATE ON public.gym_staff_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_gyms_updated_at on public.gyms;
CREATE TRIGGER trg_gyms_updated_at BEFORE UPDATE ON public.gyms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_instructor_pricing_updated_at on public.instructor_pricing;
CREATE TRIGGER trg_instructor_pricing_updated_at BEFORE UPDATE ON public.instructor_pricing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_instructor_subscriptions_updated_at on public.instructor_subscriptions;
CREATE TRIGGER trg_instructor_subscriptions_updated_at BEFORE UPDATE ON public.instructor_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_member_subscriptions_updated_at on public.member_subscriptions;
CREATE TRIGGER trg_member_subscriptions_updated_at BEFORE UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_sync_subs_to_memberships on public.member_subscriptions;
CREATE TRIGGER trg_sync_subs_to_memberships AFTER INSERT OR UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION sync_subs_to_memberships();
drop trigger if exists trg_membership_plans_updated_at on public.membership_plans;
CREATE TRIGGER trg_membership_plans_updated_at BEFORE UPDATE ON public.membership_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_memberships_updated_at on public.memberships;
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_sync_memberships_to_subs on public.memberships;
CREATE TRIGGER trg_sync_memberships_to_subs AFTER INSERT OR UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION sync_memberships_to_subs();
drop trigger if exists trg_audit_payments on public.payments;
CREATE TRIGGER trg_audit_payments AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION log_payment_change();
drop trigger if exists trg_sync_payment_status on public.payments;
CREATE TRIGGER trg_sync_payment_status BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION sync_payment_status();
drop trigger if exists trg_platform_payments_updated_at on public.platform_payments;
CREATE TRIGGER trg_platform_payments_updated_at BEFORE UPDATE ON public.platform_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_profiles_derived on public.profiles;
CREATE TRIGGER trg_profiles_derived BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_profile_derived_columns();
drop trigger if exists trg_profiles_updated_at on public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
drop trigger if exists waivers_updated_at on public.waivers;
CREATE TRIGGER waivers_updated_at BEFORE UPDATE ON public.waivers FOR EACH ROW EXECUTE FUNCTION update_waivers_updated_at();

-- auth.users → provision a profile (+ gym membership) on signup
drop trigger if exists on_auth_user_created on auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Event trigger: auto-enable RLS on any new public table (defense in depth)
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function rls_auto_enable();

-- ─── View ───────────────────────────────────────────────────────────────────
create or replace view public.pricing_plans as
 SELECT id,
    gym_id,
    name,
    description,
    duration_months,
    price,
    currency,
    features,
    is_active,
    created_at,
    updated_at
   FROM membership_plans;

-- ─── Comments ───────────────────────────────────────────────────────────────
comment on table public.instructor_bank_details is 'Coach payout bank accounts. Owner-readable only (plus service role). account_name is what Paystack /bank/resolve returned at save time, so the admin payout flow trusts it without re-resolving.';
comment on table public.memberships is 'Writes are intentionally service-role-only. Members must not self-INSERT or self-UPDATE — RLS cannot restrict which columns they edit (e.g. end_date, status), so allowing member writes would let them extend or activate their own subscription. Verify / cron / admin paths use createAdminClient.';
comment on table public.payments is 'Writes are intentionally service-role-only. Authenticated INSERT would allow a member to forge a successful payment row. Verify / webhook / cron use createAdminClient.';
comment on column public.instructor_payouts.bank_code is 'Paystack bank code (e.g. 058 for GTBank). Captured at payout time.';
comment on column public.instructor_payouts.bank_name is 'Human-readable bank name, denormalised from Paystack /bank at payout time.';
comment on column public.instructor_payouts.account_number is 'NUBAN, 10 digits. Captured at payout time so historical rows remain accurate.';
comment on column public.instructor_payouts.account_name is 'Account name returned by Paystack /bank/resolve at payout time.';
comment on column public.instructor_payouts.paystack_transfer_code is 'Per-transfer Paystack identifier. Populated when a transfer is initiated; webhook handlers match transfer.success / transfer.failed / transfer.reversed events on this to flip the row status.';
comment on column public.instructor_payouts.paystack_recipient_code is 'Coach''s Paystack transfer-recipient code. Persisted so subsequent payouts to the same coach reuse one recipient instead of creating duplicates.';
comment on column public.profiles.notification_email is 'Member consent to receive reminder/dunning emails. true by default for existing rows; user-controlled via /dashboard/profile. Transactional emails ignore this flag.';
comment on column public.profiles.notification_whatsapp is 'Member consent to receive reminder/dunning WhatsApp messages. true by default; user-controlled via /dashboard/profile. Transactional WA messages ignore this flag.';

-- ─── Grants (PostgREST roles; RLS is the authority, not these grants) ────────
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.audit_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.audit_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.audit_logs to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.business_hours to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.business_hours to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.business_hours to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.check_ins to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.check_ins to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.check_ins to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_bookings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_bookings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_bookings to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_schedules to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_schedules to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.class_schedules to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.classes to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.classes to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.classes to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.client_errors to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.client_errors to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.client_errors to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment_maintenance to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment_maintenance to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.equipment_maintenance to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expenses to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expenses to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expenses to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.export_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.export_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.export_logs to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_member_links to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_member_links to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_member_links to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_staff_links to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_staff_links to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gym_staff_links to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gyms to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gyms to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gyms to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_bank_details to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_bank_details to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_bank_details to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_payouts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_payouts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_payouts to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_pricing to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_pricing to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_pricing to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_sessions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_sessions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_sessions to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_subscriptions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_subscriptions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.instructor_subscriptions to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.member_subscriptions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.member_subscriptions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.member_subscriptions to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.membership_plans to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.membership_plans to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.membership_plans to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.memberships to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.memberships to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.memberships to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE on public.notifications to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE on public.notifications to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notifications to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payments to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_admins to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_admins to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_admins to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_payments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.platform_payments to service_role;
grant SELECT on public.pricing_plans to anon;
grant SELECT on public.pricing_plans to authenticated;
grant SELECT on public.pricing_plans to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminder_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminder_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminder_logs to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminders to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminders to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminders to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.salary_payments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.salary_payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.salary_payments to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.saved_cards to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.saved_cards to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.saved_cards to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.staff to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.staff to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.staff to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.support_tickets to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.support_tickets to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.support_tickets to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waiver_signatures to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waiver_signatures to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waiver_signatures to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waivers to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waivers to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.waivers to service_role;

-- Notifications: authenticated deliberately lacks UPDATE at the grant level;
-- the notifications_self_update policy is what scopes the one allowed write.
revoke update on public.notifications from authenticated;
revoke update on public.notifications from anon;
