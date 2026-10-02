-- The gym-assets bucket is public, so its objects are served from the Storage
-- CDN without a read-time RLS check. Server Actions allowlist raster images,
-- but an authenticated caller can address the Storage API directly wherever
-- the hosted gym_assets_staff_* write policies allow their tenant folder.
--
-- The older bucket migration still admitted image/svg+xml. SVG is active
-- content, so that direct route could store script-capable content on the
-- application's public asset origin and bypass lib/upload-image.ts. Keep AVIF:
-- it is an inert raster format and the bucket already supported it.
update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif'
]
where id = 'gym-assets';
