-- Make the Reyo Store owner account an administrator.
-- The email is not a secret; passwords remain exclusively in Supabase Auth.

UPDATE public.profiles AS p
SET role = 'ADMIN'::user_role, is_active = true, updated_at = now()
FROM auth.users AS u
WHERE u.id = p.id
  AND lower(u.email) = lower('reyostore9@gmail.com');

INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, new_data)
SELECT
  'profiles',
  p.id,
  'OWNER_ADMIN_PROVISIONED',
  p.id,
  jsonb_build_object('role', 'ADMIN', 'source', 'explicit_owner_provisioning')
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE lower(u.email) = lower('reyostore9@gmail.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs AS a
    WHERE a.record_id = p.id AND a.action = 'OWNER_ADMIN_PROVISIONED'
  );
