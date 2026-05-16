-- Fase 14: caché de resultados DataForSEO por tenant con TTL.
-- Solo escribe la API via service_role; no hay política authenticated.

CREATE TABLE public.seo_cache (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cache_key    TEXT        NOT NULL,
  endpoint_type TEXT       NOT NULL CHECK (endpoint_type IN ('volume', 'serp', 'keywords_for_url')),
  result_json  JSONB       NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX seo_cache_tenant_key ON public.seo_cache (tenant_id, cache_key);
CREATE INDEX seo_cache_expires ON public.seo_cache (expires_at);

ALTER TABLE public.seo_cache ENABLE ROW LEVEL SECURITY;
-- Sin política authenticated: solo service_role (Flask) accede a esta tabla.
