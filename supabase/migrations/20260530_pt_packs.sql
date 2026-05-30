-- Personal training session packs (Mindbody / Glofox / WellnessLiving style).
-- A member buys e.g. "10 sessions with Coach Ada" up front instead of a
-- monthly instructor subscription, and each session booked by that coach
-- draws a credit until the pack is empty.
--
-- Two tables, deliberately separate:
--   pt_packs         — the OFFERING the gym sells (per coach, per session
--                      count, per price). Edited by admin from /admin/pt-packs.
--   pt_pack_credits  — the BALANCE a member holds (one row per purchase /
--                      manual grant). sessions_used is monotonic; the
--                      balance is sessions_total - sessions_used. Service-
--                      role decrements via lib/actions/pt-packs.ts.
--
-- An expires_at column is included so a future "use within 6 months" policy
-- has somewhere to live. NULL = never expires (current default).

CREATE TABLE IF NOT EXISTS public.pt_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  instructor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  session_count   integer NOT NULL CHECK (session_count > 0 AND session_count <= 100),
  price           numeric(12,2) NOT NULL CHECK (price >= 0),
  currency        text NOT NULL DEFAULT 'NGN',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_packs_gym_instructor ON public.pt_packs (gym_id, instructor_id);

COMMENT ON TABLE public.pt_packs IS
  'Personal-training pack offerings sold by a gym for a specific coach. Created by admin; reads from /admin/pt-packs and the member-facing buy flow.';

CREATE TABLE IF NOT EXISTS public.pt_pack_credits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instructor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id         uuid REFERENCES public.pt_packs(id) ON DELETE SET NULL,
  sessions_total  integer NOT NULL CHECK (sessions_total > 0),
  sessions_used   integer NOT NULL DEFAULT 0 CHECK (sessions_used >= 0 AND sessions_used <= sessions_total),
  source          text NOT NULL DEFAULT 'admin_grant',     -- 'admin_grant' | 'paystack' | 'comp'
  paystack_reference text,
  expires_at      timestamptz,
  purchased_at    timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_pt_pack_credits_member ON public.pt_pack_credits (gym_id, member_id);
-- Most-active first per (member, instructor) so the decrement query finds
-- the right row in one index hit.
CREATE INDEX IF NOT EXISTS idx_pt_pack_credits_active
  ON public.pt_pack_credits (gym_id, member_id, instructor_id, purchased_at)
  WHERE sessions_used < sessions_total;

COMMENT ON TABLE public.pt_pack_credits IS
  'Per-member balance of PT sessions. One row per purchase/grant. sessions_used is monotonic; balance = sessions_total - sessions_used. Decremented by lib/actions/pt-packs.ts on session scheduling.';

ALTER TABLE public.pt_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_pack_credits ENABLE ROW LEVEL SECURITY;

-- Members can read their own credits (so the dashboard widget renders without
-- needing the service-role client on the member portal). Writes are
-- service-role-only — the decrement happens inside scheduleSession via the
-- admin client, gated by requireInstructor.
DROP POLICY IF EXISTS pt_pack_credits_select_self ON public.pt_pack_credits;
CREATE POLICY pt_pack_credits_select_self ON public.pt_pack_credits
  FOR SELECT
  TO authenticated
  USING (member_id = auth.uid());

-- The pack offerings are public to authenticated members at the gym (they
-- need to see what's for sale). Per-row visibility is via the public.gyms
-- relationship; gym staff use the service-role client anyway.
DROP POLICY IF EXISTS pt_packs_select_gym_members ON public.pt_packs;
CREATE POLICY pt_packs_select_gym_members ON public.pt_packs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_member_links l
      WHERE l.user_id = auth.uid()
        AND l.gym_id = pt_packs.gym_id
        AND l.is_active = true
    )
  );
