-- Provision profiles for existing Supabase Auth users.
-- This migration never stores passwords or other authentication secrets.

INSERT INTO public.profiles (id, full_name, display_name, role, is_active)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'Reyo Pack User'),
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(COALESCE(u.email, 'user'), '@', 1)),
  'PACKER'::user_role,
  true
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;

WITH owner AS (
  SELECT id FROM auth.users ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1
)
UPDATE public.profiles AS p
SET role = 'ADMIN'::user_role, is_active = true, updated_at = now()
FROM owner
WHERE p.id = owner.id;

INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, new_data)
SELECT
  'profiles',
  p.id,
  'FIRST_ADMIN_BOOTSTRAP',
  p.id,
  jsonb_build_object('role', 'ADMIN', 'source', 'owner_provisioning_migration')
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE p.role = 'ADMIN'::user_role
  AND lower(u.email) = lower((SELECT email FROM auth.users ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1))
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs AS a
    WHERE a.record_id = p.id AND a.action = 'FIRST_ADMIN_BOOTSTRAP'
  );
