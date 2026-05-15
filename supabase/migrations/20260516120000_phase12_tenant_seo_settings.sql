-- Fase 12: configuración SEO por tenant (DataForSEO cifrado + defaults de ubicación/idioma/SERP).
--
-- Credenciales DataForSEO solo vía Flask con service_role (Fernet: TENANT_SECRETS_FERNET_KEY).
-- Sin GRANT a anon/authenticated; RLS activado sin políticas para sesión de usuario.

CREATE TABLE IF NOT EXISTS public.tenant_seo_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  dataforseo_login_encrypted text,
  dataforseo_password_encrypted text,
  seo_location_code integer NOT NULL DEFAULT 2484,
  seo_language_code text NOT NULL DEFAULT 'es',
  seo_serp_mode text NOT NULL DEFAULT 'advanced',
  seo_serp_depth integer NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT tenant_seo_settings_serp_mode_check CHECK (seo_serp_mode = 'advanced'),
  CONSTRAINT tenant_seo_settings_serp_depth_check CHECK (
    seo_serp_depth >= 5 AND seo_serp_depth <= 30
  )
);

COMMENT ON TABLE public.tenant_seo_settings IS
  'Parámetros SEO/DataForSEO por tenant; secretos solo vía API Flask (service_role).';

COMMENT ON COLUMN public.tenant_seo_settings.dataforseo_login_encrypted IS
  'Login API DataForSEO cifrado con Fernet (TENANT_SECRETS_FERNET_KEY en Flask).';

COMMENT ON COLUMN public.tenant_seo_settings.dataforseo_password_encrypted IS
  'Password API DataForSEO cifrado con Fernet.';

COMMENT ON COLUMN public.tenant_seo_settings.seo_location_code IS
  'Código de ubicación DataForSEO (default 2484 = México).';

COMMENT ON COLUMN public.tenant_seo_settings.seo_language_code IS
  'Código de idioma ISO para consultas (default es).';

COMMENT ON COLUMN public.tenant_seo_settings.seo_serp_mode IS
  'Modo SERP v1: solo advanced (Google Organic live/advanced).';

COMMENT ON COLUMN public.tenant_seo_settings.seo_serp_depth IS
  'Profundidad SERP (guardrail server-side: 5–30; default 10).';

CREATE OR REPLACE FUNCTION public.tenant_seo_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_seo_settings_set_updated_at ON public.tenant_seo_settings;
CREATE TRIGGER tenant_seo_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_seo_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.tenant_seo_settings_set_updated_at();

ALTER TABLE public.tenant_seo_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_seo_settings FROM anon;
REVOKE ALL ON TABLE public.tenant_seo_settings FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_seo_settings TO service_role;
