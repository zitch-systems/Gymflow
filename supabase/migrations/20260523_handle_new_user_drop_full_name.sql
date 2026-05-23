-- Applied 2026-05-23 via Supabase MCP — follow-up to handle_new_user_full_signup.
--
-- `public.profiles.full_name` is a GENERATED column (derived from
-- first_name || ' ' || last_name), so any INSERT/UPDATE that touches it
-- fails with "cannot insert a non-DEFAULT value into column full_name".
-- The previous version of this trigger tried to populate full_name from
-- the signup metadata; this version drops the column from both the
-- INSERT and the ON CONFLICT UPDATE.
--
-- Also makes first_name / last_name extraction NULLIF-safe so empty
-- strings from the form become NULL rather than partial names.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  full_name_val text := COALESCE(meta->>'full_name', '');
  first_name_val text;
  last_name_val text;
  gym_slug_val text := NULLIF(meta->>'signup_gym_slug', '');
  gym_row record;
  active_waiver_id uuid;
BEGIN
  first_name_val := COALESCE(NULLIF(meta->>'first_name',''), NULLIF(split_part(full_name_val, ' ', 1), ''));
  last_name_val := COALESCE(
    NULLIF(meta->>'last_name',''),
    NULLIF(substring(full_name_val FROM position(' ' IN full_name_val || ' ') + 1), '')
  );

  INSERT INTO public.profiles (
    id, email,
    first_name, last_name,
    phone,
    date_of_birth, gender, address,
    nok_name, nok_relationship, nok_phone, nok_address,
    health_notes,
    waiver_signed_at,
    role,
    is_active,
    created_at
  )
  VALUES (
    NEW.id, NEW.email,
    first_name_val, last_name_val,
    NULLIF(meta->>'phone', ''),
    NULLIF(meta->>'date_of_birth', '')::date,
    NULLIF(meta->>'gender', ''),
    NULLIF(meta->>'address', ''),
    NULLIF(meta->>'nok_name', ''),
    NULLIF(meta->>'nok_relationship', ''),
    NULLIF(meta->>'nok_phone', ''),
    NULLIF(meta->>'nok_address', ''),
    NULLIF(meta->>'health_notes', ''),
    CASE WHEN (meta->>'waiver_signed') IN ('true','on','1') THEN now() ELSE NULL END,
    'member',
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name),
    phone      = COALESCE(EXCLUDED.phone,      public.profiles.phone),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
    gender     = COALESCE(EXCLUDED.gender,     public.profiles.gender),
    address    = COALESCE(EXCLUDED.address,    public.profiles.address),
    nok_name   = COALESCE(EXCLUDED.nok_name,   public.profiles.nok_name),
    nok_relationship = COALESCE(EXCLUDED.nok_relationship, public.profiles.nok_relationship),
    nok_phone  = COALESCE(EXCLUDED.nok_phone,  public.profiles.nok_phone),
    nok_address = COALESCE(EXCLUDED.nok_address, public.profiles.nok_address),
    health_notes = COALESCE(EXCLUDED.health_notes, public.profiles.health_notes),
    waiver_signed_at = COALESCE(public.profiles.waiver_signed_at, EXCLUDED.waiver_signed_at);

  IF gym_slug_val IS NOT NULL THEN
    SELECT id INTO gym_row FROM public.gyms WHERE slug = gym_slug_val LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.gym_member_links (gym_id, user_id, member_id, onboarding_method, is_active, joined_at, status)
      VALUES (gym_row.id, NEW.id, NEW.id, 'self_signup', true, now(), 'active')
      ON CONFLICT DO NOTHING;

      IF (meta->>'waiver_signed') IN ('true','on','1') THEN
        SELECT id INTO active_waiver_id
        FROM public.waivers
        WHERE gym_id = gym_row.id AND is_active = true
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1;

        IF active_waiver_id IS NOT NULL THEN
          INSERT INTO public.waiver_signatures (gym_id, waiver_id, member_id, signed_at, signature)
          VALUES (gym_row.id, active_waiver_id, NEW.id, now(), COALESCE(NULLIF(meta->>'waiver_signature', ''), 'electronic'))
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
