-- Gym amenities: a list of facility features (e.g. "Free parking", "Sauna",
-- "24/7 access") shown on the gym's public landing page and editable from the
-- admin Settings → Gym profile section.
--
-- Stored as a text[] so the admin form can post a comma-separated list and the
-- landing page can render each as a chip. Idempotent — safe to re-run.

alter table public.gyms
  add column if not exists amenities text[] not null default '{}';
