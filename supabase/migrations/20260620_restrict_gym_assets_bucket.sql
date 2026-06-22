-- Restrict the gym-assets storage bucket (readiness audit follow-up 2026-06-20).
--
-- The bucket is public, so object URLs serve via the storage CDN without
-- evaluating RLS; the broad public SELECT policy only enabled cross-gym file
-- *enumeration* (the list API) and direct authenticated getObject. The app reads
-- exclusively via getPublicUrl (no RLS) and its only writes are the gym-scoped
-- upload/update/delete policies — so dropping the read policy stops enumeration
-- without breaking image rendering.
drop policy if exists "gym_assets_read" on storage.objects;

-- Align the bucket's limits with what the app accepts (image/*, < 2 MB) so a
-- gym-scoped authenticated user can't push oversized or non-image files through
-- the raw storage API, bypassing the in-action validation.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','image/avif']
where id = 'gym-assets';
