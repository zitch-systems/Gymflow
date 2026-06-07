-- Applied 2026-05-23 via Supabase MCP.
-- Columns powering per-gym public landing pages at slug.gymflow.ng/

ALTER TABLE public.gyms
  ADD COLUMN IF NOT EXISTS tagline           text,
  ADD COLUMN IF NOT EXISTS hero_image_url    text,
  ADD COLUMN IF NOT EXISTS landing_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS landing_content   text;
