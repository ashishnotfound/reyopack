-- REYO PACK — CONTROLLED FIRST ADMIN BOOTSTRAP
-- The application checks ADMIN_BOOTSTRAP_TOKEN before calling this function.
-- The advisory lock makes the "first admin only" rule safe under concurrency.

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reyo-pack:first-admin', 0));

  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'ADMIN'::user_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ADMIN_EXISTS',
      'message', 'An administrator already exists. Ask an administrator to update your role.'
    );
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'USER_NOT_FOUND',
      'message', 'The signed-in account could not be found.'
    );
  END IF;

  INSERT INTO public.profiles (id, full_name, display_name, role, is_active)
  VALUES (
    v_user.id,
    COALESCE(v_user.raw_user_meta_data->>'full_name', v_user.email, 'Reyo Pack Owner'),
    COALESCE(v_user.raw_user_meta_data->>'display_name', split_part(COALESCE(v_user.email, 'owner'), '@', 1)),
    'PACKER'::user_role,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
  SET role = 'ADMIN'::user_role, is_active = true, updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, new_data)
  VALUES (
    'profiles',
    p_user_id,
    'FIRST_ADMIN_BOOTSTRAP',
    p_user_id,
    jsonb_build_object('role', 'ADMIN', 'source', 'controlled_bootstrap')
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOOTSTRAPPED',
    'message', 'This account is now the Reyo Pack administrator.'
  );
END;
$$;

ALTER FUNCTION public.bootstrap_first_admin(UUID) SET search_path = public, pg_catalog;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(UUID) TO service_role;
