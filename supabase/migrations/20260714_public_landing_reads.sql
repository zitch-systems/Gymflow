-- Public (anon) reads for the gym landing page's fallback path.
--
-- The landing page (app/g/[slug]) and join/login pages prefer the service-role
-- client but fall back to the anon client when the key isn't configured
-- (preview envs — and prod, should the key ever be rotated out). The code
-- treats gyms/plans/classes/hours as publicly visible (they ARE rendered to
-- the world on every gym's landing page), but only gyms actually had an anon
-- SELECT policy — in fallback mode the landing silently lost its plans,
-- classes and opening-hours sections. Align the DB with the intended (and
-- already-public) visibility, scoped to active rows where the flag exists.
--
-- Adding TO-anon policies widens nothing for signed-in users (authenticated
-- already has qual=true SELECT on these tables). Idempotent.

drop policy if exists plans_select_public on public.membership_plans;
create policy plans_select_public on public.membership_plans
  for select to anon using (is_active = true);

drop policy if exists classes_select_public on public.classes;
create policy classes_select_public on public.classes
  for select to anon using (is_active = true);

drop policy if exists bh_select_public on public.business_hours;
create policy bh_select_public on public.business_hours
  for select to anon using (true);
