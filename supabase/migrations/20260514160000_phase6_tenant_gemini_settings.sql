-- Fase 6: clave Gemini opcional por tenant (cifrada en reposo; lectura/escritura solo vía Flask con service_role).
--
-- La tabla NO debe ser accesible con la clave anon/authenticated del navegador: sin GRANT a `authenticated`
-- y RLS activado sin políticas para ese rol (denegación por omisión).
--
-- Operación: aplicar con el resto de migraciones (Supabase CLI o SQL Editor).

-- ---------------------------------------------------------------------------
-- Tabla: configuración de IA por tenant (clave Gemini cifrada con Fernet en Flask)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  gemini_api_key_encrypted text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.tenant_ai_settings IS
  'Parámetros de IA por tenant; valores sensibles solo vía API Flask (service_role).';

COMMENT ON COLUMN public.tenant_ai_settings.tenant_id IS
  'Identificador del tenant (PK y FK a tenants).';

COMMENT ON COLUMN public.tenant_ai_settings.gemini_api_key_encrypted IS
  'Clave API de Google Gemini cifrada con Fernet (clave maestra TENANT_SECRETS_FERNET_KEY en Flask).';

COMMENT ON COLUMN public.tenant_ai_settings.updated_at IS
  'Última modificación de la fila (trigger).';

COMMENT ON COLUMN public.tenant_ai_settings.updated_by IS
  'Usuario (auth.users) que realizó el último cambio, si se conoce.';

CREATE OR REPLACE FUNCTION public.tenant_ai_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_ai_settings_set_updated_at ON public.tenant_ai_settings;
CREATE TRIGGER tenant_ai_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_ai_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.tenant_ai_settings_set_updated_at();

ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;

-- Quitar privilegios directos al rol de sesión del cliente (PostgREST / supabase-js con JWT de usuario).
REVOKE ALL ON TABLE public.tenant_ai_settings FROM anon;
REVOKE ALL ON TABLE public.tenant_ai_settings FROM authenticated;

-- service_role y postgres siguen pudiendo gestionar la tabla (Flask usa service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_ai_settings TO service_role;
