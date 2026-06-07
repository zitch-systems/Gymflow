-- Allow members to upload their own avatar to the gym-assets bucket.
--
-- The original 20260523_gym_assets_storage.sql only lets active STAFF write,
-- scoped to <gym_id>/... paths. Members aren't staff, and the member avatar
-- upload (lib/actions/member-profile.ts + dashboard/profile) writes to a
-- <user_id>/avatar-... path. Without a policy for that, the client-side
-- storage.upload() is denied by RLS and the avatar feature can't work.
--
-- New policies: an authenticated user may INSERT / UPDATE / DELETE objects in
-- gym-assets whose first path segment is THEIR OWN auth.uid(). That's the
-- tightest possible scope — a member can only touch files under their own
-- id prefix, never another user's and never a gym's <gym_id>/... assets
-- (those remain staff-only via the existing policies; the two policy sets are
-- additive, each guarding a disjoint path namespace).
--
-- Public read is already granted by gym_assets_read, so rendered <img> tags
-- keep working without signed URLs.

DROP POLICY IF EXISTS "gym_assets_member_self_write"  ON storage.objects;
DROP POLICY IF EXISTS "gym_assets_member_self_update" ON storage.objects;
DROP POLICY IF EXISTS "gym_assets_member_self_delete" ON storage.objects;

CREATE POLICY "gym_assets_member_self_write"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::text
);

CREATE POLICY "gym_assets_member_self_update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::text
);

CREATE POLICY "gym_assets_member_self_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::text
);
