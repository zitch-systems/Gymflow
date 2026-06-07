-- Pause flow fix: store paused_at so resume can extend end_date by the
-- pause duration (days). Also captures the member's reason so admins
-- can see context before approving.
--
-- Instructor auto-renew uses the existing instructor_subscriptions.auto_renew
-- column — no schema change there.

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS paused_at    timestamptz,
  ADD COLUMN IF NOT EXISTS pause_reason text;

ALTER TABLE public.instructor_subscriptions
  ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;

-- For the auto-debit cron looking up saved cards for instructor subs,
-- ensure (gym_id, member_id, is_active=true) lookup is fast.
CREATE INDEX IF NOT EXISTS idx_saved_cards_active
  ON public.saved_cards(gym_id, member_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_instructor_subscriptions_renewal
  ON public.instructor_subscriptions(gym_id, end_date)
  WHERE status = 'active' AND auto_renew = true;
