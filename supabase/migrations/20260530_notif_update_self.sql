-- Member-facing in-app notification inbox — RLS UPDATE policy so members
-- can mark THEIR OWN notifications as read.
--
-- The existing notif_select_self_or_gym SELECT policy (baseline + 7a) already
-- lets a member read their own rows and a staff/owner read all rows for their
-- gym. Writes were previously service-role-only (announcements.ts uses
-- createAdminClient). To support the inbox's "mark as read" without going
-- through a server action that uses the admin key for every tap, members get
-- a tightly-scoped UPDATE policy that:
--
--   - matches only their own rows (user_id = auth.uid())
--   - constrains both USING and WITH CHECK so a malicious caller can't
--     row-hop or change user_id mid-update
--
-- Application-side, the toggle action only sets is_read + read_at, so even
-- with broader column access here the surface stays narrow.

CREATE POLICY "notif_update_self"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON POLICY "notif_update_self" ON public.notifications IS
  'Members can mark their own in-app notifications as read. Use via lib/actions/notifications.ts; never expose a broader update path.';
