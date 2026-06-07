-- Member tags + staff notes — admin-facing CRM-style annotations on each
-- member, scoped per gym (a member at gym A is tagged separately from the
-- same member at gym B).
--
-- Two surfaces:
--
--   1. member_tags — many tags per member. Free-text, gym-scoped. Used for
--      segmenting / future broadcast targeting / quick filtering on the
--      members list. A unique constraint on (gym_id, user_id, tag) makes
--      "add tag" idempotent and forbids exact-duplicate tags on one member.
--
--   2. gym_member_links.staff_notes — single free-text field per link row.
--      Visible only to gym staff (RLS already restricts gym_member_links to
--      staff/owner of that gym, and we never expose this column to the
--      member portal). Useful for "prefers morning classes", "knee injury",
--      "trial — convert by 31 May", etc.
--
-- Both are additive; existing rows are untouched. Service-role-only writes
-- (the actions go through createAdminClient + requireStaff), so no extra RLS
-- policies are needed beyond table-level RLS on member_tags.

ALTER TABLE public.gym_member_links
  ADD COLUMN IF NOT EXISTS staff_notes text;

COMMENT ON COLUMN public.gym_member_links.staff_notes IS
  'Free-text staff-only notes about this member at this gym. Never exposed to the member portal. Written via lib/actions/member-admin.ts, gated by requireStaff.';

CREATE TABLE IF NOT EXISTS public.member_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (gym_id, user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_member_tags_gym_user ON public.member_tags (gym_id, user_id);

COMMENT ON TABLE public.member_tags IS
  'Per-gym member tags (CRM-style labels: "VIP", "Trial", "Personal training"…). Many tags per member. Writes go through requireStaff; reads from the gym admin portal only.';

ALTER TABLE public.member_tags ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so we deliberately have no policies for
-- `authenticated` — the only legitimate writer is the service-role admin
-- client invoked from a requireStaff-gated action. This matches the pattern
-- used by other admin-only tables (memberships, payments, audit_logs).
