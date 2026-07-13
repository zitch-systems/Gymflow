-- Curated Instagram posts for the gym's public landing page. Gyms paste a few
-- Instagram post/reel permalinks in Settings; the landing page renders them as
-- real embedded posts (Instagram's official embed) in an "On Instagram" section.
-- Stored as an ordered array of permalink URLs (capped in the app layer).
alter table public.gyms add column if not exists instagram_posts text[];
