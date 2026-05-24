-- Test-data seed for the gf-test-gym Supabase project.
-- Already applied 2026-05-23 via Supabase MCP. Kept here for re-use if
-- the test gym is ever wiped or a fresh dev environment needs the same
-- role-flavoured users wired up.
--
-- Idempotent: every statement is safe to re-run.
--
-- Schema quirks worth knowing:
--   - profiles.role is TEXT with CHECK constraint:
--       owner | manager | staff | instructor | member | platform_admin
--     ('gym_owner' is NOT allowed — that lives in user_role enum only.)
--   - gym_staff_links.role is the user_role ENUM:
--       gym_owner | manager | front_desk | accountant | instructor | ...
--   - gym_staff_links UNIQUE constraint is (gym_id, user_id, role), so a
--     user can hold multiple roles at one gym.
--   - platform_admins requires name + email NOT NULL.

-- ─── 1. Ensure the test gym's landing page is enabled ──────────────────
UPDATE public.gyms
   SET landing_enabled = true,
       updated_at      = NOW()
 WHERE slug = 'gf-test-gym' AND (landing_enabled IS DISTINCT FROM true);

-- ─── 2. Seed gym_staff_links for role-flavoured test users ─────────────
DO $$
DECLARE
  v_gym_id uuid;
  rec record;
BEGIN
  SELECT id INTO v_gym_id FROM public.gyms WHERE slug = 'gf-test-gym';
  IF v_gym_id IS NULL THEN RAISE EXCEPTION 'Test gym gf-test-gym not found'; END IF;

  FOR rec IN SELECT * FROM (VALUES
    ('owner@gymflow-test.com',      'gym_owner'::user_role),
    ('staff@gymflow-test.com',      'manager'::user_role),
    ('instructor@gymflow-test.com', 'instructor'::user_role)
  ) AS t(email, r)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.gym_staff_links gsl
      JOIN public.profiles p ON p.id = gsl.user_id
      WHERE p.email = rec.email AND gsl.gym_id = v_gym_id AND gsl.role = rec.r
    ) THEN
      INSERT INTO public.gym_staff_links (gym_id, user_id, role, is_active, joined_at)
      SELECT v_gym_id, p.id, rec.r, true, NOW()
      FROM public.profiles p WHERE p.email = rec.email;
    END IF;
  END LOOP;

  -- Sync profile roles to match the link role (text form — 'owner' not 'gym_owner')
  UPDATE public.profiles SET role = 'owner'      WHERE email = 'owner@gymflow-test.com'      AND role IS DISTINCT FROM 'owner';
  UPDATE public.profiles SET role = 'manager'    WHERE email = 'staff@gymflow-test.com'      AND role IS DISTINCT FROM 'manager';
  UPDATE public.profiles SET role = 'instructor' WHERE email = 'instructor@gymflow-test.com' AND role IS DISTINCT FROM 'instructor';
END $$;

-- ─── 3. Make admin@gymflow-test.com a platform_admin ──────────────────
INSERT INTO public.platform_admins (user_id, name, email, created_at)
SELECT p.id, COALESCE(p.full_name, p.email, 'Admin'), p.email, NOW()
  FROM public.profiles p
 WHERE p.email = 'admin@gymflow-test.com'
   AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id);

-- ─── 4. Give the test instructor a monthly subscription rate ──────────
INSERT INTO public.instructor_pricing (gym_id, instructor_id, duration_days, price, billing_period, currency, is_active)
SELECT g.id, p.id, 30, 15000, 'monthly', 'NGN', true
  FROM public.gyms g, public.profiles p
 WHERE g.slug = 'gf-test-gym' AND p.email = 'instructor@gymflow-test.com'
   AND NOT EXISTS (SELECT 1 FROM public.instructor_pricing ip
                    WHERE ip.gym_id = g.id AND ip.instructor_id = p.id AND ip.billing_period = 'monthly');

-- ─── Verify ───────────────────────────────────────────────────────────
SELECT slug, landing_enabled FROM public.gyms WHERE slug = 'gf-test-gym';
SELECT p.email, gsl.role::text AS staff_role, gsl.is_active, p.role AS profile_role
  FROM public.gym_staff_links gsl JOIN public.profiles p ON p.id = gsl.user_id
 WHERE p.email LIKE '%@gymflow-test.com' ORDER BY p.email;
SELECT p.email FROM public.platform_admins pa JOIN public.profiles p ON p.id = pa.user_id;
