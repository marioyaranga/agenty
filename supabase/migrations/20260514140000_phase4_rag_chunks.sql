-- Fase 4: chunks RAG + pgvector + RPC de similitud (cosine) para recuperación.
--
-- Requisitos: extensión `vector` (esquema `extensions` en Supabase).
-- Índice vectorial: HNSW con operador coseno. Si el proyecto usa una versión de
-- pgvector sin HNSW, comentar el CREATE INDEX HNSW y usar IVFFlat documentado abajo.
--
-- Cómo aplicar: docs/operations/04-phase4-rag-pgvector.md

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Tabla public.document_chunks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  heading_path text NOT NULL DEFAULT ''::text,
  body text NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chunks_document_chunk_index_unique UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_tenant_document_idx
  ON public.document_chunks (tenant_id, document_id);

-- HNSW + distancia coseno (pgvector reciente).
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON public.document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Alternativa documentada si HNSW no está disponible en tu imagen de Postgres:
-- DROP INDEX IF EXISTS document_chunks_embedding_hnsw_idx;
-- CREATE INDEX document_chunks_embedding_ivfflat_idx
--   ON public.document_chunks
--   USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);
-- Tras carga masiva con IVFFlat, ejecutar: ANALYZE public.document_chunks;

COMMENT ON TABLE public.document_chunks IS
  'Fragmentos indexados (Markdown) con embedding para RAG; escritura solo service_role.';

COMMENT ON COLUMN public.document_chunks.heading_path IS
  'Ruta jerárquica de encabezados Markdown (breadcrumb legible).';

COMMENT ON COLUMN public.document_chunks.embedding IS
  'Vector gemini-embedding-001 con dimensionalidad 1536 (cosine en consulta).';

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_chunks FROM PUBLIC;
GRANT SELECT ON TABLE public.document_chunks TO authenticated;
GRANT ALL ON TABLE public.document_chunks TO service_role;

-- SELECT: miembros del tenant (misma convención que documents).
DROP POLICY IF EXISTS document_chunks_select_member ON public.document_chunks;
CREATE POLICY document_chunks_select_member
  ON public.document_chunks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = document_chunks.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- Sin políticas INSERT/UPDATE/DELETE para authenticated: solo lectura vía RLS.

-- ---------------------------------------------------------------------------
-- RPC: match por similitud coseno (1 - distancia coseno pgvector).
-- SECURITY DEFINER + search_path fijo; invocación solo service_role (Flask).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  p_tenant_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count integer,
  p_min_similarity double precision
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  heading_path text,
  body text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    dc.heading_path,
    dc.body,
    (1 - (dc.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.document_chunks dc
  WHERE dc.tenant_id = p_tenant_id
    AND (1 - (dc.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY dc.embedding <=> p_query_embedding ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 8), 200));
$$;

ALTER FUNCTION public.match_document_chunks(
  uuid,
  extensions.vector(1536),
  integer,
  double precision
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.match_document_chunks(
  uuid,
  extensions.vector(1536),
  integer,
  double precision
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.match_document_chunks(
  uuid,
  extensions.vector(1536),
  integer,
  double precision
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(
  uuid,
  extensions.vector(1536),
  integer,
  double precision
) TO service_role;
