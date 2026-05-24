-- Applied 2026-05-23 via Supabase MCP.
--
-- Storage bucket for everything a gym admin uploads from the portal:
-- equipment photos, expense receipts, gym logos.
--
-- Public read so we can render <img> tags from the dashboard without
-- signed URLs. Writes/updates/deletes scoped via RLS to staff of the
-- gym whose UUID forms the first segment of the file path:
--   <gym_id>/equipment/<filename>
--   <gym_id>/receipts/<filename>
--   <gym_id>/logo/<filename>

INSERT INTO storage.buckets (id, name, public)
VALUES ('gym-assets', 'gym-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gym_assets_read"          ON storage.objects;
DROP POLICY IF EXISTS "gym_assets_staff_write"   ON storage.objects;
DROP POLICY IF EXISTS "gym_assets_staff_update"  ON storage.objects;
DROP POLICY IF EXISTS "gym_assets_staff_delete"  ON storage.objects;

CREATE POLICY "gym_assets_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'gym-assets');

CREATE POLICY "gym_assets_staff_write"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.gym_staff_links s
    WHERE s.user_id = auth.uid()
      AND s.is_active = true
      AND s.gym_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY "gym_assets_staff_update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.gym_staff_links s
    WHERE s.user_id = auth.uid()
      AND s.is_active = true
      AND s.gym_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY "gym_assets_staff_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'gym-assets'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.gym_staff_links s
    WHERE s.user_id = auth.uid()
      AND s.is_active = true
      AND s.gym_id::text = split_part(name, '/', 1)
  )
);
