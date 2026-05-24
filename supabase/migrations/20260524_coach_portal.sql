-- Coach portal schema additions (to be applied via Supabase MCP).
--
-- Fixes one bug + adds three new tables/columns the instructor portal needs.
--
-- Bug: instructor_subscriptions has no member_id, so we can't tell which
-- member subscribed to which instructor. Add it.
--
-- New tables:
--   instructor_sessions  — 1-on-1 session log + attendance status
--   instructor_payouts   — instructor-initiated payout requests
--
-- New profile columns: bio, specialisation, certifications (rates already
-- live on instructor_pricing).
--
-- New gym column: instructor_revenue_share_pct (% the instructor keeps of
-- subscription revenue; admin pays out the rest manually for now).

-- 1. Fix instructor_subscriptions → add member_id
ALTER TABLE public.instructor_subscriptions
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_member
  ON public.instructor_subscriptions(member_id);

CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_instructor
  ON public.instructor_subscriptions(instructor_id, status);

-- 2. Profile extension columns for instructor bio
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio              text,
  ADD COLUMN IF NOT EXISTS specialisation   text,
  ADD COLUMN IF NOT EXISTS certifications   text;

-- 3. Per-gym revenue share for instructor subscriptions
ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS instructor_revenue_share_pct integer NOT NULL DEFAULT 50
  CHECK (instructor_revenue_share_pct BETWEEN 0 AND 100);

-- 4. 1-on-1 instructor sessions (attendance + scheduling)
CREATE TABLE IF NOT EXISTS public.instructor_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  instructor_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_at     timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
  notes            text,
  marked_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructor_sessions_instructor_time
  ON public.instructor_sessions(instructor_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_sessions_member_time
  ON public.instructor_sessions(member_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_sessions_gym
  ON public.instructor_sessions(gym_id, scheduled_at DESC);

-- 5. Instructor payout requests
CREATE TABLE IF NOT EXISTS public.instructor_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
  notes         text,
  processed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  processed_at  timestamptz,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_instructor
  ON public.instructor_payouts(instructor_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_gym_status
  ON public.instructor_payouts(gym_id, status);
