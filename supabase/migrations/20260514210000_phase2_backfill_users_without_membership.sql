-- Usuarios que existían en auth.users antes del trigger `on_auth_user_created_bootstrap_tenant`
-- quedan sin fila en tenant_memberships. Esta migración crea un espacio por usuario afectado
-- (idempotente: solo si no hay ninguna membresía para ese user_id).

DO $$
DECLARE
  r RECORD;
  new_tenant_id uuid;
BEGIN
  FOR r IN
    SELECT u.id
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.user_id = u.id
    )
  LOOP
    new_tenant_id := gen_random_uuid();
    INSERT INTO public.tenants (id, name)
    VALUES (new_tenant_id, 'Mi espacio');
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
    VALUES (new_tenant_id, r.id, 'owner');
  END LOOP;
END $$;
