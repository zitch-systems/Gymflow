-- Gym-configurable marketing/tracking + live-chat integrations for the public
-- landing page. Stored as a small jsonb map of public IDs the gym pastes in
-- Settings → Integrations, e.g.:
--   { "ga4": "G-XXXXXXX", "meta_pixel": "123456789",
--     "chat_provider": "crisp", "chat_id": "<website-id>" }
-- Only validated public IDs are ever stored, and the landing page interpolates
-- them into fixed script templates (never raw HTML), so there's no injection
-- surface. No secrets here — these are all client-side public identifiers.
alter table public.gyms add column if not exists integrations jsonb;
