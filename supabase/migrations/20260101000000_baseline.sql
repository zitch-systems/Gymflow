-- ───────────────────────────────────────────────────────────────────────
-- GymFlow baseline schema (reconstructed via Supabase MCP)
-- Generated: 2026-05-24
-- Source: project kdbbrxqxqewbjoozmfhq (eu-west-1)
--
-- This is a reconstructed dump, not pg_dump output. It captures the public
-- schema: extensions, enums, tables, constraints, indexes, RLS policies,
-- functions, triggers. Apply on a fresh Supabase project to bootstrap.
--
-- Subsequent migrations in this directory (20260523_*, 20260524_*) layer
-- on top of this baseline.
-- ───────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ── Enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.equipment_condition AS ENUM ('excellent','good','fair','needs_repair','out_of_service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.expense_category AS ENUM ('utilities','maintenance','supplies','salaries','rent','marketing','equipment','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.gym_status AS ENUM ('active','suspended','terminated','trial'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.notification_channel AS ENUM ('email','whatsapp','sms'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.notification_event AS ENUM ('welcome','payment_receipt','expiry_reminder_7','expiry_reminder_3','expiry_reminder_1','membership_expired','auto_renewal_success','auto_renewal_failed','pause_approved','login_credentials','check_in_confirmation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_method AS ENUM ('card','bank_transfer','cash','auto_debit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_status AS ENUM ('successful','failed','pending','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.salary_frequency AS ENUM ('monthly','weekly','biweekly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.subscription_status AS ENUM ('active','paused','pause_requested','expired','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.user_role AS ENUM ('platform_admin','gym_owner','manager','front_desk','accountant','instructor','member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "actor_id" uuid,
  "action" text NOT NULL,
  "table_name" text NOT NULL,
  "record_id" uuid,
  "old_values" jsonb,
  "new_values" jsonb,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid
);

CREATE TABLE IF NOT EXISTS public.business_hours (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "day_of_week" integer NOT NULL,
  "open_time" time without time zone,
  "close_time" time without time zone,
  "is_closed" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.check_ins (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "member_id" uuid,
  "checked_in_at" timestamp with time zone DEFAULT now(),
  "checked_out_at" timestamp with time zone,
  "status" text DEFAULT 'active'::text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "device_info" text,
  "check_in_method" text DEFAULT 'manual'::text
);

CREATE TABLE IF NOT EXISTS public.class_bookings (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "class_schedule_id" uuid,
  "class_id" uuid,
  "member_id" uuid,
  "status" text DEFAULT 'booked'::text,
  "booking_date" date DEFAULT CURRENT_DATE,
  "booked_at" timestamp with time zone DEFAULT now(),
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "checked_in" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.class_schedules (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "class_id" uuid,
  "instructor_id" uuid,
  "day_of_week" integer NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "room" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.classes (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "instructor_id" uuid,
  "max_capacity" integer DEFAULT 20,
  "duration_minutes" integer DEFAULT 60,
  "category" text,
  "level" text DEFAULT 'all'::text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "day_of_week" text DEFAULT 'Monday'::text NOT NULL,
  "start_time" text DEFAULT '09:00'::text NOT NULL,
  "end_time" text DEFAULT '10:00'::text NOT NULL,
  "instructor" text
);

CREATE TABLE IF NOT EXISTS public.client_errors (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "user_id" uuid,
  "page" text,
  "error_type" text,
  "message" text,
  "stack" text,
  "severity" text DEFAULT 'error'::text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "page_url" text
);

CREATE TABLE IF NOT EXISTS public.equipment (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "name" text NOT NULL,
  "category" text DEFAULT 'General'::text,
  "description" text,
  "serial_number" text,
  "purchase_date" date,
  "purchase_price" numeric(12,2) DEFAULT 0,
  "vendor" text,
  "warranty_expiry" date,
  "status" text DEFAULT 'active'::text,
  "location" text,
  "photo_url" text,
  "last_maintenance_date" date,
  "next_maintenance_date" date,
  "maintenance_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.equipment_maintenance (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "equipment_id" uuid NOT NULL,
  "maintenance_type" text NOT NULL,
  "description" text,
  "cost" numeric(12,2) DEFAULT 0,
  "performed_by" text,
  "performed_at" date DEFAULT CURRENT_DATE,
  "next_due" date,
  "status" text DEFAULT 'completed'::text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "category" text NOT NULL,
  "description" text,
  "amount" numeric(12,2) NOT NULL,
  "expense_date" date DEFAULT CURRENT_DATE,
  "receipt_url" text,
  "is_recurring" boolean DEFAULT false,
  "recurring_frequency" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.export_logs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "filter" text,
  "member_count" integer,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gym_member_links (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "user_id" uuid,
  "member_id" uuid,
  "joined_at" timestamp with time zone DEFAULT now(),
  "onboarding_method" text DEFAULT 'self_signup'::text,
  "status" text DEFAULT 'active'::text,
  "is_active" boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.gym_staff_links (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" public.user_role NOT NULL,
  "salary" numeric(12,2),
  "salary_frequency" public.salary_frequency DEFAULT 'monthly'::public.salary_frequency,
  "bank_name" text,
  "bank_account_number" text,
  "hire_date" date,
  "terminated_at" timestamp with time zone,
  "termination_reason" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'active'::text
);

CREATE TABLE IF NOT EXISTS public.gyms (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "logo_url" text,
  "address" text,
  "city" text,
  "state" text,
  "country" text DEFAULT 'Nigeria'::text,
  "phone" text,
  "email" text,
  "website" text,
  "status" text DEFAULT 'active'::text,
  "trial_ends_at" timestamp with time zone,
  "subscription_status" text DEFAULT 'trial'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "timezone" text DEFAULT 'Africa/Lagos'::text,
  "currency" text DEFAULT 'NGN'::text,
  "max_members" integer DEFAULT 500,
  "subscription_plan" text DEFAULT 'starter'::text,
  "tagline" text,
  "hero_image_url" text,
  "landing_enabled" boolean DEFAULT true NOT NULL,
  "landing_content" text,
  "instructor_revenue_share_pct" integer DEFAULT 50 NOT NULL,
  "paystack_subaccount_code" text,
  "bank_code" text,
  "bank_name" text,
  "account_number" text,
  "account_name" text,
  "platform_commission_pct" numeric(5,2) DEFAULT 5.00 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.instructor_payouts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "instructor_id" uuid NOT NULL,
  "amount" numeric(10,2) NOT NULL,
  "status" text DEFAULT 'requested'::text NOT NULL,
  "notes" text,
  "processed_by" uuid,
  "processed_at" timestamp with time zone,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.instructor_pricing (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "instructor_id" uuid NOT NULL,
  "duration_days" integer NOT NULL,
  "price" numeric(12,2) NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "plan_name" text,
  "currency" text DEFAULT 'NGN'::text,
  "billing_period" text DEFAULT 'monthly'::text,
  "features" jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.instructor_sessions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "instructor_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "status" text DEFAULT 'scheduled'::text NOT NULL,
  "notes" text,
  "marked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.instructor_subscriptions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "instructor_id" uuid NOT NULL,
  "plan_id" uuid,
  "status" text DEFAULT 'active'::text,
  "start_date" date DEFAULT CURRENT_DATE,
  "end_date" date,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "amount_paid" numeric DEFAULT 0,
  "payment_reference" text,
  "member_id" uuid,
  "auto_renew" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.member_subscriptions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "plan_id" uuid,
  "start_date" date DEFAULT CURRENT_DATE NOT NULL,
  "end_date" date NOT NULL,
  "status" text DEFAULT 'active'::text,
  "auto_debit_enabled" boolean DEFAULT false,
  "payment_method" text DEFAULT 'card'::text,
  "paystack_subscription_code" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.membership_plans (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "duration_months" integer NOT NULL,
  "price" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'NGN'::text,
  "features" jsonb DEFAULT '[]'::jsonb,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.memberships (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "member_id" uuid,
  "plan_id" uuid,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text DEFAULT 'active'::text,
  "auto_renew" boolean DEFAULT false,
  "payment_method" text DEFAULT 'card'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "auto_debit_enabled" boolean DEFAULT false,
  "paused_at" timestamp with time zone,
  "pause_reason" text
);

CREATE TABLE IF NOT EXISTS public.notifications (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "user_id" uuid,
  "title" text NOT NULL,
  "body" text,
  "type" text DEFAULT 'info'::text,
  "channel" text DEFAULT 'in_app'::text,
  "is_read" boolean DEFAULT false,
  "sent_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "member_id" uuid,
  "plan_id" uuid,
  "amount" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'NGN'::text,
  "paystack_reference" text,
  "payment_method" text DEFAULT 'card'::text,
  "payment_date" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'pending'::text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "payment_status" text DEFAULT 'pending'::text,
  "paystack_authorization_code" text
);

CREATE TABLE IF NOT EXISTS public.platform_admins (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.platform_payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "amount" numeric(12,2) DEFAULT 20000.00 NOT NULL,
  "payment_status" public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
  "paystack_reference" text,
  "billing_period_start" date NOT NULL,
  "billing_period_end" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "currency" text DEFAULT 'NGN'::text,
  "plan" text DEFAULT 'starter'::text
);

CREATE TABLE IF NOT EXISTS public.profiles (
  "id" uuid NOT NULL,
  "gym_id" uuid,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "role" text DEFAULT 'member'::text,
  "avatar_url" text,
  "waiver_signed_at" timestamp with time zone,
  "waiver_signature" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "health_notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "full_name" text,
  "email" text,
  "date_of_birth" date,
  "gender" text,
  "address" text,
  "nok_name" text,
  "nok_relationship" text,
  "nok_phone" text,
  "nok_address" text,
  "photo_url" text,
  "member_id" text,
  "user_id" uuid,
  "bio" text,
  "specialisation" text,
  "certifications" text
);

CREATE TABLE IF NOT EXISTS public.reminder_logs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "action" text NOT NULL,
  "channel" text DEFAULT 'sms'::text NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "message_preview" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminders (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "type" text NOT NULL,
  "channel" text NOT NULL,
  "template" text,
  "schedule" timestamp with time zone,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "days_before" integer DEFAULT 3
);

CREATE TABLE IF NOT EXISTS public.salary_payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "staff_link_id" uuid NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "payment_date" date NOT NULL,
  "payment_method" text,
  "payment_period" text,
  "notes" text,
  "paid_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "staff_id" uuid,
  "status" text DEFAULT 'paid'::text,
  "period_start" date,
  "period_end" date
);

CREATE TABLE IF NOT EXISTS public.saved_cards (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "authorization_code" text NOT NULL,
  "card_type" text,
  "last4" text,
  "exp_month" text,
  "exp_year" text,
  "bank" text,
  "brand" text,
  "reusable" boolean DEFAULT true,
  "email" text,
  "is_default" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "expiry_month" integer,
  "expiry_year" integer,
  "paystack_authorization_code" text
);

CREATE TABLE IF NOT EXISTS public.staff (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "user_id" uuid,
  "profile_id" uuid,
  "role" text NOT NULL,
  "salary" numeric(12,2),
  "hire_date" date,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.waiver_signatures (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "waiver_id" uuid,
  "member_id" uuid,
  "signature" text,
  "signed_at" timestamp with time zone DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  "gym_id" uuid,
  "signature_data" text
);

CREATE TABLE IF NOT EXISTS public.waivers (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "version" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- ── Constraints (PK + FK + UNIQUE + CHECK) ──────────────────────────────
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.business_hours ADD CONSTRAINT business_hours_pkey PRIMARY KEY (id);
ALTER TABLE public.business_hours ADD CONSTRAINT business_hours_day_of_week_check CHECK ((day_of_week >= 0) AND (day_of_week <= 6));
ALTER TABLE public.business_hours ADD CONSTRAINT business_hours_gym_id_day_of_week_key UNIQUE (gym_id, day_of_week);
ALTER TABLE public.business_hours ADD CONSTRAINT business_hours_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;

ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_pkey PRIMARY KEY (id);
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_status_check CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'overstay'::text]));

ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_class_schedule_id_fkey FOREIGN KEY (class_schedule_id) REFERENCES public.class_schedules(id) ON DELETE CASCADE;
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_gym_id_class_schedule_id_member_id_key UNIQUE (gym_id, class_schedule_id, member_id);
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.class_bookings ADD CONSTRAINT class_bookings_status_check CHECK (status = ANY (ARRAY['booked'::text, 'attended'::text, 'cancelled'::text, 'no_show'::text]));

ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_day_of_week_check CHECK ((day_of_week >= 0) AND (day_of_week <= 6));
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.profiles(id);

ALTER TABLE public.classes ADD CONSTRAINT classes_pkey PRIMARY KEY (id);
ALTER TABLE public.classes ADD CONSTRAINT classes_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.classes ADD CONSTRAINT classes_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.profiles(id);
ALTER TABLE public.classes ADD CONSTRAINT classes_level_check CHECK (level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text, 'all'::text]));

ALTER TABLE public.client_errors ADD CONSTRAINT client_errors_pkey PRIMARY KEY (id);
ALTER TABLE public.client_errors ADD CONSTRAINT client_errors_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE SET NULL;
ALTER TABLE public.client_errors ADD CONSTRAINT client_errors_severity_check CHECK (severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'fatal'::text]));
ALTER TABLE public.client_errors ADD CONSTRAINT client_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.equipment ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);
ALTER TABLE public.equipment ADD CONSTRAINT equipment_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.equipment ADD CONSTRAINT equipment_status_check CHECK (status = ANY (ARRAY['active'::text, 'maintenance'::text, 'retired'::text, 'lost'::text]));

ALTER TABLE public.equipment_maintenance ADD CONSTRAINT equipment_maintenance_pkey PRIMARY KEY (id);
ALTER TABLE public.equipment_maintenance ADD CONSTRAINT equipment_maintenance_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;
ALTER TABLE public.equipment_maintenance ADD CONSTRAINT equipment_maintenance_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.equipment_maintenance ADD CONSTRAINT equipment_maintenance_maintenance_type_check CHECK (maintenance_type = ANY (ARRAY['routine'::text, 'repair'::text, 'inspection'::text, 'replacement'::text]));
ALTER TABLE public.equipment_maintenance ADD CONSTRAINT equipment_maintenance_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]));

ALTER TABLE public.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE public.expenses ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.expenses ADD CONSTRAINT expenses_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_recurring_frequency_check CHECK (recurring_frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]));

ALTER TABLE public.export_logs ADD CONSTRAINT export_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.gym_member_links ADD CONSTRAINT gym_member_links_pkey PRIMARY KEY (id);
ALTER TABLE public.gym_member_links ADD CONSTRAINT gym_member_links_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.gym_member_links ADD CONSTRAINT gym_member_links_gym_id_user_id_key UNIQUE (gym_id, user_id);
ALTER TABLE public.gym_member_links ADD CONSTRAINT gym_member_links_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.gym_member_links ADD CONSTRAINT gym_member_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.gym_staff_links ADD CONSTRAINT gym_staff_links_pkey PRIMARY KEY (id);
ALTER TABLE public.gym_staff_links ADD CONSTRAINT gym_staff_links_gym_id_user_id_role_key UNIQUE (gym_id, user_id, role);
ALTER TABLE public.gym_staff_links ADD CONSTRAINT gym_staff_links_role_check CHECK (role = ANY (ARRAY['gym_owner'::public.user_role, 'manager'::public.user_role, 'front_desk'::public.user_role, 'accountant'::public.user_role, 'instructor'::public.user_role]));

ALTER TABLE public.gyms ADD CONSTRAINT gyms_pkey PRIMARY KEY (id);
ALTER TABLE public.gyms ADD CONSTRAINT gyms_slug_key UNIQUE (slug);
ALTER TABLE public.gyms ADD CONSTRAINT gyms_instructor_revenue_share_pct_check CHECK ((instructor_revenue_share_pct >= 0) AND (instructor_revenue_share_pct <= 100));
ALTER TABLE public.gyms ADD CONSTRAINT gyms_platform_commission_pct_check CHECK ((platform_commission_pct >= (0)::numeric) AND (platform_commission_pct <= (100)::numeric));
ALTER TABLE public.gyms ADD CONSTRAINT gyms_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text]));
ALTER TABLE public.gyms ADD CONSTRAINT gyms_subscription_status_check CHECK (subscription_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'cancelled'::text]));

ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_amount_check CHECK (amount > (0)::numeric);
ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.instructor_payouts ADD CONSTRAINT instructor_payouts_status_check CHECK (status = ANY (ARRAY['requested'::text, 'approved'::text, 'paid'::text, 'rejected'::text]));

ALTER TABLE public.instructor_pricing ADD CONSTRAINT instructor_pricing_pkey PRIMARY KEY (id);

ALTER TABLE public.instructor_sessions ADD CONSTRAINT instructor_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_sessions ADD CONSTRAINT instructor_sessions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_sessions ADD CONSTRAINT instructor_sessions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_sessions ADD CONSTRAINT instructor_sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_sessions ADD CONSTRAINT instructor_sessions_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text]));

ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE SET NULL;
ALTER TABLE public.instructor_subscriptions ADD CONSTRAINT instructor_subscriptions_status_check CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text]));

ALTER TABLE public.member_subscriptions ADD CONSTRAINT member_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.member_subscriptions ADD CONSTRAINT member_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.member_subscriptions ADD CONSTRAINT member_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.member_subscriptions ADD CONSTRAINT member_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE SET NULL;
ALTER TABLE public.member_subscriptions ADD CONSTRAINT member_subscriptions_status_check CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text]));

ALTER TABLE public.membership_plans ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.membership_plans ADD CONSTRAINT membership_plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;

ALTER TABLE public.memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);
ALTER TABLE public.memberships ADD CONSTRAINT memberships_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE SET NULL;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_status_check CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'paused'::text]));

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check CHECK (channel = ANY (ARRAY['in_app'::text, 'email'::text, 'sms'::text, 'whatsapp'::text, 'push'::text]));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'success'::text, 'payment'::text, 'checkin'::text, 'class'::text]));

ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.payments ADD CONSTRAINT payments_paystack_reference_key UNIQUE (paystack_reference);
ALTER TABLE public.payments ADD CONSTRAINT payments_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT payments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id);
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check CHECK (payment_method = ANY (ARRAY['card'::text, 'bank_transfer'::text, 'cash'::text, 'crypto'::text]));
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_status_check CHECK (payment_status = ANY (ARRAY['pending'::text, 'successful'::text, 'failed'::text, 'refunded'::text]));
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text, 'refunded'::text]));

ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_email_key UNIQUE (email);
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.platform_payments ADD CONSTRAINT platform_payments_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_payments ADD CONSTRAINT platform_payments_paystack_reference_key UNIQUE (paystack_reference);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'instructor'::text, 'member'::text, 'platform_admin'::text]));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_gender_check CHECK (gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'prefer_not_to_say'::text]));

ALTER TABLE public.reminder_logs ADD CONSTRAINT reminder_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.reminders ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);
ALTER TABLE public.reminders ADD CONSTRAINT reminders_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.reminders ADD CONSTRAINT reminders_channel_check CHECK (channel = ANY (ARRAY['sms'::text, 'whatsapp'::text, 'email'::text, 'push'::text]));
ALTER TABLE public.reminders ADD CONSTRAINT reminders_type_check CHECK (type = ANY (ARRAY['membership_expiring'::text, 'payment_due'::text, 'class_reminder'::text, 'birthday'::text, 'custom'::text]));

ALTER TABLE public.salary_payments ADD CONSTRAINT salary_payments_pkey PRIMARY KEY (id);
ALTER TABLE public.salary_payments ADD CONSTRAINT salary_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id);
ALTER TABLE public.salary_payments ADD CONSTRAINT salary_payments_staff_link_id_fkey FOREIGN KEY (staff_link_id) REFERENCES public.gym_staff_links(id) ON DELETE CASCADE;
ALTER TABLE public.salary_payments ADD CONSTRAINT salary_payments_payment_method_check CHECK (payment_method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'other'::text]));

ALTER TABLE public.saved_cards ADD CONSTRAINT saved_cards_pkey PRIMARY KEY (id);
ALTER TABLE public.saved_cards ADD CONSTRAINT saved_cards_member_id_authorization_code_key UNIQUE (member_id, authorization_code);
ALTER TABLE public.saved_cards ADD CONSTRAINT saved_cards_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.saved_cards ADD CONSTRAINT saved_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.staff ADD CONSTRAINT staff_pkey PRIMARY KEY (id);
ALTER TABLE public.staff ADD CONSTRAINT staff_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;
ALTER TABLE public.staff ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.staff ADD CONSTRAINT staff_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_check CHECK (role = ANY (ARRAY['manager'::text, 'instructor'::text, 'receptionist'::text, 'maintenance'::text]));

ALTER TABLE public.waiver_signatures ADD CONSTRAINT waiver_signatures_pkey PRIMARY KEY (id);
ALTER TABLE public.waiver_signatures ADD CONSTRAINT waiver_signatures_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id);
ALTER TABLE public.waiver_signatures ADD CONSTRAINT waiver_signatures_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.waiver_signatures ADD CONSTRAINT waiver_signatures_waiver_id_fkey FOREIGN KEY (waiver_id) REFERENCES public.waivers(id) ON DELETE CASCADE;

ALTER TABLE public.waivers ADD CONSTRAINT waivers_pkey PRIMARY KEY (id);
ALTER TABLE public.waivers ADD CONSTRAINT waivers_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;

-- ── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_gym_id ON public.audit_logs (gym_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs (table_name);
CREATE INDEX IF NOT EXISTS idx_business_hours_gym ON public.business_hours (gym_id);
CREATE INDEX IF NOT EXISTS idx_checkins_datetime ON public.check_ins (gym_id, checked_in_at);
CREATE INDEX IF NOT EXISTS idx_checkins_gym ON public.check_ins (gym_id);
CREATE INDEX IF NOT EXISTS idx_checkins_member ON public.check_ins (member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_member ON public.class_bookings (member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON public.class_bookings (class_schedule_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_class_date ON public.class_bookings (class_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_class_bookings_member ON public.class_bookings (member_id, status);
CREATE INDEX IF NOT EXISTS idx_schedules_class ON public.class_schedules (class_id);
CREATE INDEX IF NOT EXISTS idx_schedules_day ON public.class_schedules (day_of_week);
CREATE INDEX IF NOT EXISTS idx_classes_gym ON public.classes (gym_id);
CREATE INDEX IF NOT EXISTS idx_classes_gym_day ON public.classes (gym_id, day_of_week, is_active);
CREATE INDEX IF NOT EXISTS idx_classes_instructor ON public.classes (instructor_id);
CREATE INDEX IF NOT EXISTS idx_equipment_gym ON public.equipment (gym_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment (status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_gym ON public.expenses (gym_id);
CREATE INDEX IF NOT EXISTS idx_expenses_recurring ON public.expenses (gym_id, is_recurring) WHERE (is_recurring = true);
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_gym_id ON public.gym_staff_links (gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_staff_links_user_id ON public.gym_staff_links (user_id);
CREATE INDEX IF NOT EXISTS idx_gyms_paystack_subaccount ON public.gyms (paystack_subaccount_code) WHERE (paystack_subaccount_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_gym_status ON public.instructor_payouts (gym_id, status);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_instructor ON public.instructor_payouts (instructor_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_gym ON public.instructor_sessions (gym_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_instructor_time ON public.instructor_sessions (instructor_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_sessions_member_time ON public.instructor_sessions (member_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_instructor ON public.instructor_subscriptions (instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_member ON public.instructor_subscriptions (member_id);
CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_renewal ON public.instructor_subscriptions (gym_id, end_date) WHERE ((status = 'active'::text) AND (auto_renew = true));
CREATE INDEX IF NOT EXISTS idx_memberships_end_date ON public.memberships (end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_gym ON public.memberships (gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON public.memberships (member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON public.memberships (status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments (gym_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_gym ON public.payments (gym_id);
CREATE INDEX IF NOT EXISTS idx_payments_member ON public.payments (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_profiles_gym ON public.profiles (gym_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_created ON public.reminder_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_gym_action ON public.reminder_logs (gym_id, action);
CREATE INDEX IF NOT EXISTS idx_reminders_gym ON public.reminders (gym_id);
CREATE INDEX IF NOT EXISTS idx_reminders_type ON public.reminders (type);
CREATE INDEX IF NOT EXISTS idx_saved_cards_active ON public.saved_cards (gym_id, member_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_staff_gym ON public.staff (gym_id);
CREATE INDEX IF NOT EXISTS idx_waivers_gym ON public.waivers (gym_id);

-- ── Enable RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_member_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_staff_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waivers ENABLE ROW LEVEL SECURITY;

-- ── Functions ───────────────────────────────────────────────────────────
-- Helper: identify platform admin
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'platform_admin' AND COALESCE(is_active, true) = true)
      OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

-- Helper: profile visibility (self / same-gym staff/member / platform_admin)
CREATE OR REPLACE FUNCTION public.can_see_profile(target_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links me
      JOIN public.gym_member_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid() AND me.is_active = true AND them.user_id = target_user_id)
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links me
      JOIN public.gym_staff_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid() AND me.is_active = true AND them.user_id = target_user_id AND them.is_active = true)
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_gym_role(p_gym_id uuid, p_roles public.user_role[]) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_staff_links
    WHERE gym_id = p_gym_id AND user_id = auth.uid() AND role = ANY(p_roles) AND is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gym_member(_gym_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM gym_member_links WHERE user_id = auth.uid() AND gym_id = _gym_id)
      OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND gym_id = _gym_id AND is_active = true)
      OR is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.is_gym_owner(_gym_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND gym_id = _gym_id AND role IN ('owner','manager') AND is_active = true)
      OR is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.is_gym_staff(_gym_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND gym_id = _gym_id AND role IN ('owner','manager','staff','instructor') AND is_active = true)
      OR is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.get_current_gym_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT gym_id FROM profiles WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.gym_id_from_waiver(_waiver_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT gym_id FROM waivers WHERE id = _waiver_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.update_waivers_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.expire_subscriptions() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE expired_count integer;
BEGIN
  WITH updated AS (
    UPDATE memberships SET status = 'expired', updated_at = now()
    WHERE status = 'active' AND end_date < CURRENT_DATE
    RETURNING id)
  SELECT COUNT(*) INTO expired_count FROM updated;
  UPDATE member_subscriptions SET status = 'expired', updated_at = now()
  WHERE status = 'active' AND end_date < CURRENT_DATE;
  RETURN expired_count;
END $$;

CREATE OR REPLACE FUNCTION public.sync_payment_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.payment_status = CASE NEW.status
      WHEN 'success' THEN 'successful' WHEN 'failed' THEN 'failed'
      WHEN 'refunded' THEN 'refunded' ELSE 'pending' END;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    NEW.status = CASE NEW.payment_status
      WHEN 'successful' THEN 'success' WHEN 'failed' THEN 'failed'
      WHEN 'refunded' THEN 'refunded' ELSE 'pending' END;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.log_payment_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_logs (gym_id, user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    COALESCE(NEW.gym_id, OLD.gym_id), auth.uid(),
    LOWER(TG_OP) || '.payment', 'payments', COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_profile_derived_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.full_name IS NULL OR NEW.full_name = '' THEN
    NEW.full_name := NULLIF(TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), '');
  END IF;
  IF NEW.full_name IS NOT NULL AND NEW.first_name IS NULL AND NEW.last_name IS NULL THEN
    NEW.first_name := SPLIT_PART(NEW.full_name, ' ', 1);
    NEW.last_name := NULLIF(TRIM(SUBSTR(NEW.full_name, LENGTH(SPLIT_PART(NEW.full_name,' ',1)) + 2)), '');
  END IF;
  NEW.member_id := UPPER(REPLACE(NEW.id::TEXT, '-', ''));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_memberships_to_subs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_setting('app.syncing_memberships', true) = 'true' THEN RETURN NEW; END IF;
  PERFORM set_config('app.syncing_memberships', 'true', true);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO member_subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, status, auto_debit_enabled, payment_method, created_at, updated_at)
    VALUES (NEW.id, NEW.gym_id, NEW.member_id, NEW.plan_id, NEW.start_date, NEW.end_date, NEW.status, COALESCE(NEW.auto_debit_enabled, false), COALESCE(NEW.payment_method,'card'), NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, end_date = EXCLUDED.end_date, updated_at = now();
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE member_subscriptions SET status = NEW.status, end_date = NEW.end_date, plan_id = NEW.plan_id, auto_debit_enabled = COALESCE(NEW.auto_debit_enabled, false), updated_at = now() WHERE id = NEW.id;
  END IF;
  PERFORM set_config('app.syncing_memberships', 'false', true);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_subs_to_memberships() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_setting('app.syncing_memberships', true) = 'true' THEN RETURN NEW; END IF;
  PERFORM set_config('app.syncing_memberships', 'true', true);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO memberships (id, gym_id, member_id, plan_id, start_date, end_date, status, auto_debit_enabled, payment_method, created_at, updated_at)
    VALUES (NEW.id, NEW.gym_id, NEW.member_id, NEW.plan_id, NEW.start_date, NEW.end_date, NEW.status, COALESCE(NEW.auto_debit_enabled, false), COALESCE(NEW.payment_method,'card'), NEW.created_at, NOW())
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, end_date = EXCLUDED.end_date, updated_at = now();
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE memberships SET status = NEW.status, end_date = NEW.end_date, plan_id = NEW.plan_id, updated_at = now() WHERE id = NEW.id;
  END IF;
  PERFORM set_config('app.syncing_memberships', 'false', true);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  full_name_val text := COALESCE(meta->>'full_name', '');
  first_name_val text;
  last_name_val text;
  gym_slug_val text := NULLIF(meta->>'signup_gym_slug', '');
  gym_row record;
  active_waiver_id uuid;
BEGIN
  first_name_val := COALESCE(NULLIF(meta->>'first_name',''), NULLIF(split_part(full_name_val, ' ', 1), ''));
  last_name_val := COALESCE(NULLIF(meta->>'last_name',''), NULLIF(substring(full_name_val FROM position(' ' IN full_name_val || ' ') + 1), ''));
  INSERT INTO public.profiles (id, email, first_name, last_name, phone, date_of_birth, gender, address,
    nok_name, nok_relationship, nok_phone, nok_address, health_notes, waiver_signed_at, role, is_active, created_at)
  VALUES (NEW.id, NEW.email, first_name_val, last_name_val, NULLIF(meta->>'phone', ''),
    NULLIF(meta->>'date_of_birth', '')::date, NULLIF(meta->>'gender', ''), NULLIF(meta->>'address', ''),
    NULLIF(meta->>'nok_name', ''), NULLIF(meta->>'nok_relationship', ''), NULLIF(meta->>'nok_phone', ''),
    NULLIF(meta->>'nok_address', ''), NULLIF(meta->>'health_notes', ''),
    CASE WHEN (meta->>'waiver_signed') IN ('true','on','1') THEN now() ELSE NULL END,
    'member', true, now())
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email,
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
    gender = COALESCE(EXCLUDED.gender, public.profiles.gender),
    address = COALESCE(EXCLUDED.address, public.profiles.address),
    nok_name = COALESCE(EXCLUDED.nok_name, public.profiles.nok_name),
    nok_relationship = COALESCE(EXCLUDED.nok_relationship, public.profiles.nok_relationship),
    nok_phone = COALESCE(EXCLUDED.nok_phone, public.profiles.nok_phone),
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
        SELECT id INTO active_waiver_id FROM public.waivers WHERE gym_id = gym_row.id AND is_active = true
        ORDER BY created_at DESC NULLS LAST LIMIT 1;
        IF active_waiver_id IS NOT NULL THEN
          INSERT INTO public.waiver_signatures (gym_id, waiver_id, member_id, signed_at, signature)
          VALUES (gym_row.id, active_waiver_id, NEW.id, now(), COALESCE(NULLIF(meta->>'waiver_signature', ''), 'electronic'))
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── RLS Policies ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO service_role WITH CHECK (true);
DROP POLICY IF EXISTS "audit_logs_select_gym_owner" ON public.audit_logs;
CREATE POLICY "audit_logs_select_gym_owner" ON public.audit_logs FOR SELECT TO public USING (has_gym_role(gym_id, ARRAY['gym_owner'::user_role]));
DROP POLICY IF EXISTS "audit_logs_select_platform_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_platform_admin" ON public.audit_logs FOR SELECT TO authenticated USING (is_platform_admin());

DROP POLICY IF EXISTS "bh_select" ON public.business_hours;
CREATE POLICY "bh_select" ON public.business_hours FOR SELECT TO public USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = business_hours.gym_id));
DROP POLICY IF EXISTS "bh_insert_owner" ON public.business_hours;
CREATE POLICY "bh_insert_owner" ON public.business_hours FOR INSERT TO public WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = business_hours.gym_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));
DROP POLICY IF EXISTS "bh_update_owner" ON public.business_hours;
CREATE POLICY "bh_update_owner" ON public.business_hours FOR UPDATE TO public USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = business_hours.gym_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));
DROP POLICY IF EXISTS "bh_delete_owner" ON public.business_hours;
CREATE POLICY "bh_delete_owner" ON public.business_hours FOR DELETE TO public USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = business_hours.gym_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

DROP POLICY IF EXISTS "checkins_select_scoped" ON public.check_ins;
CREATE POLICY "checkins_select_scoped" ON public.check_ins FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = check_ins.gym_id AND s.user_id = auth.uid() AND s.is_active = true) OR is_platform_admin());

DROP POLICY IF EXISTS "bookings_member_select" ON public.class_bookings;
CREATE POLICY "bookings_member_select" ON public.class_bookings FOR SELECT TO authenticated USING (member_id = auth.uid());
DROP POLICY IF EXISTS "bookings_member_insert" ON public.class_bookings;
CREATE POLICY "bookings_member_insert" ON public.class_bookings FOR INSERT TO authenticated WITH CHECK ((member_id = auth.uid()) AND (gym_id IN (SELECT gym_id FROM gym_member_links WHERE user_id = auth.uid())));
DROP POLICY IF EXISTS "bookings_member_update_own" ON public.class_bookings;
CREATE POLICY "bookings_member_update_own" ON public.class_bookings FOR UPDATE TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());
DROP POLICY IF EXISTS "bookings_staff_select" ON public.class_bookings;
CREATE POLICY "bookings_staff_select" ON public.class_bookings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = class_bookings.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "bookings_staff_update" ON public.class_bookings;
CREATE POLICY "bookings_staff_update" ON public.class_bookings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = class_bookings.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "bookings_instructor_select" ON public.class_bookings;
CREATE POLICY "bookings_instructor_select" ON public.class_bookings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM class_schedules cs WHERE cs.id = class_bookings.class_schedule_id AND cs.instructor_id = auth.uid()));
DROP POLICY IF EXISTS "bookings_instructor_update" ON public.class_bookings;
CREATE POLICY "bookings_instructor_update" ON public.class_bookings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM class_schedules cs WHERE cs.id = class_bookings.class_schedule_id AND cs.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "schedules_select" ON public.class_schedules;
CREATE POLICY "schedules_select" ON public.class_schedules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "classes_select" ON public.classes;
CREATE POLICY "classes_select" ON public.classes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "classes_member_view" ON public.classes;
CREATE POLICY "classes_member_view" ON public.classes FOR SELECT TO authenticated USING ((gym_id IN (SELECT gym_id FROM gym_member_links WHERE user_id = auth.uid())) AND (is_active = true));

DROP POLICY IF EXISTS "client_errors_insert" ON public.client_errors;
CREATE POLICY "client_errors_insert" ON public.client_errors FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "client_errors_select_admin" ON public.client_errors;
CREATE POLICY "client_errors_select_admin" ON public.client_errors FOR SELECT TO public USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (ARRAY['owner'::text,'manager'::text,'platform_admin'::text])));

DROP POLICY IF EXISTS "equipment_select_staff" ON public.equipment;
CREATE POLICY "equipment_select_staff" ON public.equipment FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = equipment.gym_id AND s.user_id = auth.uid() AND s.is_active = true) OR is_platform_admin());

DROP POLICY IF EXISTS "equipment_maintenance_gym" ON public.equipment_maintenance;
CREATE POLICY "equipment_maintenance_gym" ON public.equipment_maintenance FOR ALL TO public USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = equipment_maintenance.gym_id));

DROP POLICY IF EXISTS "expenses_staff_all" ON public.expenses;
CREATE POLICY "expenses_staff_all" ON public.expenses FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = expenses.gym_id AND s.user_id = auth.uid() AND s.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = expenses.gym_id AND s.user_id = auth.uid() AND s.is_active = true));

DROP POLICY IF EXISTS "export_logs_insert_service" ON public.export_logs;
CREATE POLICY "export_logs_insert_service" ON public.export_logs FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "export_logs_select_staff" ON public.export_logs;
CREATE POLICY "export_logs_select_staff" ON public.export_logs FOR SELECT TO public USING (EXISTS (SELECT 1 FROM gym_staff_links WHERE gym_id = export_logs.gym_id AND user_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS "gml_select" ON public.gym_member_links;
CREATE POLICY "gml_select" ON public.gym_member_links FOR SELECT TO public USING ((auth.uid() = user_id) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.user_id = auth.uid() AND s.gym_id = gym_member_links.gym_id) OR is_platform_admin());
DROP POLICY IF EXISTS "gml_insert_self" ON public.gym_member_links;
CREATE POLICY "gml_insert_self" ON public.gym_member_links FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "gml_update_self" ON public.gym_member_links;
CREATE POLICY "gml_update_self" ON public.gym_member_links FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_staff_links_all" ON public.gym_staff_links;
CREATE POLICY "gym_staff_links_all" ON public.gym_staff_links FOR ALL TO public USING ((user_id = auth.uid()) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = gym_staff_links.gym_id AND role = ANY (ARRAY['owner'::text,'manager'::text])));
DROP POLICY IF EXISTS "gym_staff_links_select_own" ON public.gym_staff_links;
CREATE POLICY "gym_staff_links_select_own" ON public.gym_staff_links FOR SELECT TO public USING (user_id = auth.uid());
DROP POLICY IF EXISTS "gym_staff_links_select_manager" ON public.gym_staff_links;
CREATE POLICY "gym_staff_links_select_manager" ON public.gym_staff_links FOR SELECT TO public USING (has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role]));

DROP POLICY IF EXISTS "gyms_select" ON public.gyms;
CREATE POLICY "gyms_select" ON public.gyms FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "gyms_insert" ON public.gyms;
CREATE POLICY "gyms_insert" ON public.gyms FOR INSERT TO public WITH CHECK (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "gyms_update_owner_only" ON public.gyms;
CREATE POLICY "gyms_update_owner_only" ON public.gyms FOR UPDATE TO public USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = gyms.id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));
DROP POLICY IF EXISTS "gyms_delete_owner_only" ON public.gyms;
CREATE POLICY "gyms_delete_owner_only" ON public.gyms FOR DELETE TO public USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.gym_id = gyms.id AND p.role = 'owner'::text));

DROP POLICY IF EXISTS "ipay_select" ON public.instructor_payouts;
CREATE POLICY "ipay_select" ON public.instructor_payouts FOR SELECT TO authenticated USING ((instructor_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_payouts.gym_id AND s.user_id = auth.uid() AND s.role = ANY (ARRAY['gym_owner'::user_role,'manager'::user_role]) AND s.is_active = true));
DROP POLICY IF EXISTS "ipay_insert_instructor" ON public.instructor_payouts;
CREATE POLICY "ipay_insert_instructor" ON public.instructor_payouts FOR INSERT TO authenticated WITH CHECK (instructor_id = auth.uid());
DROP POLICY IF EXISTS "ipay_update_admin" ON public.instructor_payouts;
CREATE POLICY "ipay_update_admin" ON public.instructor_payouts FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_payouts.gym_id AND s.user_id = auth.uid() AND s.role = ANY (ARRAY['gym_owner'::user_role,'manager'::user_role]) AND s.is_active = true));

DROP POLICY IF EXISTS "instructor_pricing_select_public" ON public.instructor_pricing;
CREATE POLICY "instructor_pricing_select_public" ON public.instructor_pricing FOR SELECT TO public USING (is_active = true);

DROP POLICY IF EXISTS "isess_select" ON public.instructor_sessions;
CREATE POLICY "isess_select" ON public.instructor_sessions FOR SELECT TO authenticated USING ((instructor_id = auth.uid()) OR (member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_sessions.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "isess_insert_instructor" ON public.instructor_sessions;
CREATE POLICY "isess_insert_instructor" ON public.instructor_sessions FOR INSERT TO authenticated WITH CHECK ((instructor_id = auth.uid()) AND EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_sessions.gym_id AND s.user_id = auth.uid() AND s.role = 'instructor'::user_role AND s.is_active = true));
DROP POLICY IF EXISTS "isess_update_instructor" ON public.instructor_sessions;
CREATE POLICY "isess_update_instructor" ON public.instructor_sessions FOR UPDATE TO authenticated USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "is_select_self_or_gym" ON public.instructor_subscriptions;
CREATE POLICY "is_select_self_or_gym" ON public.instructor_subscriptions FOR SELECT TO authenticated USING ((instructor_id = auth.uid()) OR (member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_subscriptions.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "is_insert_self" ON public.instructor_subscriptions;
CREATE POLICY "is_insert_self" ON public.instructor_subscriptions FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
DROP POLICY IF EXISTS "is_update_self_or_instructor" ON public.instructor_subscriptions;
CREATE POLICY "is_update_self_or_instructor" ON public.instructor_subscriptions FOR UPDATE TO authenticated USING ((member_id = auth.uid()) OR (instructor_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = instructor_subscriptions.gym_id AND s.user_id = auth.uid() AND s.is_active = true));

DROP POLICY IF EXISTS "msub_select_self_or_gym" ON public.member_subscriptions;
CREATE POLICY "msub_select_self_or_gym" ON public.member_subscriptions FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = member_subscriptions.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "msub_update_self" ON public.member_subscriptions;
CREATE POLICY "msub_update_self" ON public.member_subscriptions FOR UPDATE TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());

DROP POLICY IF EXISTS "plans_select" ON public.membership_plans;
CREATE POLICY "plans_select" ON public.membership_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "memberships_select_scoped" ON public.memberships;
CREATE POLICY "memberships_select_scoped" ON public.memberships FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = memberships.gym_id AND s.user_id = auth.uid() AND s.is_active = true) OR is_platform_admin());

DROP POLICY IF EXISTS "notif_select_self_or_gym" ON public.notifications;
CREATE POLICY "notif_select_self_or_gym" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = notifications.gym_id AND s.user_id = auth.uid() AND s.role = ANY (ARRAY['gym_owner'::user_role,'manager'::user_role]) AND s.is_active = true));

DROP POLICY IF EXISTS "payments_select_scoped" ON public.payments;
CREATE POLICY "payments_select_scoped" ON public.payments FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = payments.gym_id AND s.user_id = auth.uid() AND s.is_active = true) OR is_platform_admin());

DROP POLICY IF EXISTS "pa_select_self" ON public.platform_admins;
CREATE POLICY "pa_select_self" ON public.platform_admins FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "pp_select_gym_or_admin" ON public.platform_payments;
CREATE POLICY "pp_select_gym_or_admin" ON public.platform_payments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = platform_payments.gym_id AND s.user_id = auth.uid() AND s.role = 'gym_owner'::user_role AND s.is_active = true) OR EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = auth.uid()));

DROP POLICY IF EXISTS "profiles_select_scoped" ON public.profiles;
CREATE POLICY "profiles_select_scoped" ON public.profiles FOR SELECT TO authenticated USING (can_see_profile(id));
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO public WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_no_escalation" ON public.profiles;
CREATE POLICY "profiles_update_no_escalation" ON public.profiles FOR UPDATE TO public USING (auth.uid() = id) WITH CHECK ((auth.uid() = id) AND (NOT (role IS DISTINCT FROM (SELECT p2.role FROM profiles p2 WHERE p2.id = auth.uid()))));
DROP POLICY IF EXISTS "profiles_delete_none" ON public.profiles;
CREATE POLICY "profiles_delete_none" ON public.profiles FOR DELETE TO public USING (false);

DROP POLICY IF EXISTS "reminder_logs_insert_function" ON public.reminder_logs;
CREATE POLICY "reminder_logs_insert_function" ON public.reminder_logs FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "reminder_logs_select_staff" ON public.reminder_logs;
CREATE POLICY "reminder_logs_select_staff" ON public.reminder_logs FOR SELECT TO public USING (EXISTS (SELECT 1 FROM gym_staff_links WHERE gym_id = reminder_logs.gym_id AND user_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS "salary_payments_owner" ON public.salary_payments;
CREATE POLICY "salary_payments_owner" ON public.salary_payments FOR ALL TO public USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND gym_id = salary_payments.gym_id AND role = ANY (ARRAY['owner'::text,'manager'::text])));

DROP POLICY IF EXISTS "cards_member_all" ON public.saved_cards;
CREATE POLICY "cards_member_all" ON public.saved_cards FOR ALL TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());

DROP POLICY IF EXISTS "signatures_select_scoped" ON public.waiver_signatures;
CREATE POLICY "signatures_select_scoped" ON public.waiver_signatures FOR SELECT TO authenticated USING ((member_id = auth.uid()) OR EXISTS (SELECT 1 FROM gym_staff_links s WHERE s.gym_id = waiver_signatures.gym_id AND s.user_id = auth.uid() AND s.is_active = true));
DROP POLICY IF EXISTS "signatures_member_insert" ON public.waiver_signatures;
CREATE POLICY "signatures_member_insert" ON public.waiver_signatures FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());

DROP POLICY IF EXISTS "waivers_select" ON public.waivers;
CREATE POLICY "waivers_select" ON public.waivers FOR SELECT TO authenticated USING (true);

-- ── Triggers ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_classes_updated_at ON public.classes;
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_equipment_updated_at ON public.equipment;
CREATE TRIGGER trg_equipment_updated_at BEFORE UPDATE ON public.equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_gym_staff_links_updated_at ON public.gym_staff_links;
CREATE TRIGGER trg_gym_staff_links_updated_at BEFORE UPDATE ON public.gym_staff_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_gyms_updated_at ON public.gyms;
CREATE TRIGGER trg_gyms_updated_at BEFORE UPDATE ON public.gyms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_instructor_pricing_updated_at ON public.instructor_pricing;
CREATE TRIGGER trg_instructor_pricing_updated_at BEFORE UPDATE ON public.instructor_pricing FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_instructor_subscriptions_updated_at ON public.instructor_subscriptions;
CREATE TRIGGER trg_instructor_subscriptions_updated_at BEFORE UPDATE ON public.instructor_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_member_subscriptions_updated_at ON public.member_subscriptions;
CREATE TRIGGER trg_member_subscriptions_updated_at BEFORE UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sync_subs_to_memberships ON public.member_subscriptions;
CREATE TRIGGER trg_sync_subs_to_memberships AFTER INSERT OR UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION sync_subs_to_memberships();

DROP TRIGGER IF EXISTS trg_membership_plans_updated_at ON public.membership_plans;
CREATE TRIGGER trg_membership_plans_updated_at BEFORE UPDATE ON public.membership_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_memberships_updated_at ON public.memberships;
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sync_memberships_to_subs ON public.memberships;
CREATE TRIGGER trg_sync_memberships_to_subs AFTER INSERT OR UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION sync_memberships_to_subs();

DROP TRIGGER IF EXISTS trg_sync_payment_status ON public.payments;
CREATE TRIGGER trg_sync_payment_status BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION sync_payment_status();

DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments;
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION log_payment_change();

DROP TRIGGER IF EXISTS trg_platform_payments_updated_at ON public.platform_payments;
CREATE TRIGGER trg_platform_payments_updated_at BEFORE UPDATE ON public.platform_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_derived ON public.profiles;
CREATE TRIGGER trg_profiles_derived BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_profile_derived_columns();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS waivers_updated_at ON public.waivers;
CREATE TRIGGER waivers_updated_at BEFORE UPDATE ON public.waivers FOR EACH ROW EXECUTE FUNCTION update_waivers_updated_at();

-- handle_new_user trigger lives on auth.users — not recreated here because
-- auth schema is owned by Supabase. Re-create separately if you spin up
-- from this baseline:
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
