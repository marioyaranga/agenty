-- Fase 2: multi-tenant mínimo (tenants + membresías) + RLS + bootstrap en alta de usuario.
--
-- Cómo aplicar en producción (Supabase Dashboard):
-- 1) SQL Editor → New query → pegar este archivo completo → Run.
-- 2) Verificar: `select * from pg_policies where tablename in ('tenants','tenant_memberships');`
-- 3) Probar signup de un usuario de prueba; debe existir 1 fila en `public.tenants` y 1 en
--    `public.tenant_memberships` con role `owner` (trigger en `auth.users`).
-- 4) Security Advisor en Dashboard → revisar hallazgos tras el cambio.
--
-- Orden: esta migración es autocontenida (crea schema `private`, tablas, políticas, trigger).
-- Si ya existían objetos con el mismo nombre, ajustar manualmente antes de ejecutar.

-- Esquema privado: funciones SECURITY DEFINER no expuestas como API PostgREST.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Tablas públicas (accesibles vía API con clave anon/publishable + JWT + RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'viewer'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_memberships_tenant_user_unique UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_memberships_user_id_idx ON public.tenant_memberships (user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_id_idx ON public.tenant_memberships (tenant_id);

COMMENT ON TABLE public.tenants IS 'Organización / espacio de trabajo (multi-tenant).';
COMMENT ON TABLE public.tenant_memberships IS 'Membresía de usuario en tenant con rol RBAC.';

-- Privilegios mínimos para el rol de sesión de usuario (RLS aplica encima).
GRANT SELECT, UPDATE ON public.tenants TO authenticated;
GRANT SELECT ON public.tenant_memberships TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- Nota Supabase/Postgres: UPDATE requiere política SELECT coherente sobre la misma fila.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

-- Membresías: el usuario autenticado solo lee sus propias filas.
-- Altas iniciales: solo vía trigger SECURITY DEFINER (bypass RLS como owner postgres).
-- No se concede INSERT genérico a `authenticated` para evitar auto-asignación a tenants ajenos.

DROP POLICY IF EXISTS tenant_memberships_select_own ON public.tenant_memberships;
CREATE POLICY tenant_memberships_select_own
  ON public.tenant_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Tenants: lectura si el usuario tiene membresía.
DROP POLICY IF EXISTS tenants_select_if_member ON public.tenants;
CREATE POLICY tenants_select_if_member
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenants.id
        AND m.user_id = auth.uid()
    )
  );

-- UPDATE nombre: solo owner o admin (SELECT ya permitido a miembros; owner/admin cumplen EXISTS).
DROP POLICY IF EXISTS tenants_update_name_owner_admin ON public.tenants;
CREATE POLICY tenants_update_name_owner_admin
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenants.id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenants.id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Trigger bootstrap: un tenant por defecto + membresía owner
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.bootstrap_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_tenant_id uuid;
BEGIN
  INSERT INTO public.tenants (id, name)
  VALUES (gen_random_uuid(), 'Mi espacio')
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (new_tenant_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.bootstrap_new_auth_user() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.bootstrap_new_auth_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.bootstrap_new_auth_user() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION private.bootstrap_new_auth_user() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created_bootstrap_tenant ON auth.users;
CREATE TRIGGER on_auth_user_created_bootstrap_tenant
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE private.bootstrap_new_auth_user();
