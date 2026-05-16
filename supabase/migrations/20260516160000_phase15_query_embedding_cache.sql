-- Fase 15: caché de embeddings de queries semánticas (determinísticos por modelo).
-- Scope global (no por tenant): la misma query siempre produce el mismo vector.
-- Solo escribe la API via service_role; sin política authenticated.

CREATE TABLE public.query_embedding_cache (
  query_hash   TEXT        PRIMARY KEY,
  embedding    VECTOR(1536) NOT NULL,
  created_at   TIMESTAMPTZ  DEFAULT now() NOT NULL
);

ALTER TABLE public.query_embedding_cache ENABLE ROW LEVEL SECURITY;
-- Sin política authenticated: solo service_role (Flask) accede a esta tabla.
