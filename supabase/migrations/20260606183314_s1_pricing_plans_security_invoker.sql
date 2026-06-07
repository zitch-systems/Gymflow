-- S1: pricing_plans was a SECURITY DEFINER view (Supabase linter ERROR
-- level 0010). The view is a literal pass-through of membership_plans, so
-- SECURITY DEFINER granted bearer-token-less callers the view-creator's
-- read access, bypassing RLS on membership_plans. No app code reads from
-- pricing_plans (verified via repo grep; only references are
-- database.types.ts and a historical migration), so the safe fix is to
-- recreate it with security_invoker = true and lock the grants down to
-- SELECT only.
DROP VIEW IF EXISTS public.pricing_plans;

CREATE VIEW public.pricing_plans
  WITH (security_invoker = true) AS
  SELECT id, gym_id, name, description, duration_months, price, currency,
         features, is_active, created_at, updated_at
  FROM public.membership_plans;

REVOKE ALL ON public.pricing_plans FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT ON public.pricing_plans TO anon, authenticated, service_role;
