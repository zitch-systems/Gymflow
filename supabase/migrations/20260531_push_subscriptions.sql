-- Web Push subscriptions — one row per browser/device a member has opted in
-- on. Powers operational pushes (announcements, payment/payout alerts) when
-- VAPID keys are configured; the whole feature degrades to a no-op when they
-- aren't, so this table can ship ahead of key provisioning.
--
-- A subscription's `endpoint` is the push-service URL the browser hands us
-- (unique per device+origin); `p256dh` + `auth` are the client keys used to
-- encrypt the payload per RFC 8291. We prune rows server-side when the push
-- service returns 404/410 (subscription gone), so this stays self-cleaning.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id      uuid REFERENCES public.gyms(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_gym ON public.push_subscriptions (gym_id);

COMMENT ON TABLE public.push_subscriptions IS
  'Web Push (RFC 8291) subscriptions, one per opted-in device. Written via /api/push/subscribe; read service-side by lib/web-push.ts to fan out notifications. Self-cleaning: dead endpoints (404/410) are pruned on send.';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A member manages only their own subscriptions. The send path uses the
-- service-role client (no session), which bypasses RLS.
CREATE POLICY "push_sub_select_self" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "push_sub_insert_self" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "push_sub_delete_self" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
