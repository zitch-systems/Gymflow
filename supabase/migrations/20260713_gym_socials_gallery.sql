-- Per-gym social media handles and a photo gallery, both shown on the gym's
-- public landing page and edited from admin Settings.
--   social_links — jsonb map of platform → handle-or-URL (instagram, facebook,
--     x, tiktok, youtube, whatsapp). Stored as entered; the landing page
--     normalizes each into a link.
--   gallery_urls — ordered list of public image URLs in the gym-assets bucket.
-- Idempotent. Safe to re-run.

alter table public.gyms
  add column if not exists social_links jsonb  not null default '{}'::jsonb,
  add column if not exists gallery_urls text[]  not null default '{}';
