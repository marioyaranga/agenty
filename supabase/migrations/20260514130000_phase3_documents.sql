-- Fase 3: documentos por tenant (metadatos en Postgres, binarios en Storage privado).
--
-- index_status: preparado para pipeline RAG futuro (embeddings en otra fase).
-- Convención: pending = pendiente de indexar; ready = indexado o no requiere indexación;
-- failed = error en indexación (index_error opcional).
--
-- Storage: bucket privado `tenant_documents`; I/O vía Flask (service_role) en Fase 3.
-- Políticas finas en storage.objects se pueden endurecer si el cliente lee/escribe directo.
--
-- Cómo aplicar en producción: ver docs/operations/03-phase3-documents-storage.md

-- ---------------------------------------------------------------------------
-- Bucket privado (id = name; public = false)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant_documents', 'tenant_documents', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tabla public.documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  title text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  index_status text NOT NULL DEFAULT 'pending'::text
    CHECK (index_status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])),
  index_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_tenant_storage_path_unique UNIQUE (tenant_id, storage_path)
);

CREATE INDEX IF NOT EXISTS documents_tenant_updated_at_idx
  ON public.documents (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS documents_tenant_created_by_idx
  ON public.documents (tenant_id, created_by);

COMMENT ON TABLE public.documents IS
  'Metadatos de documentos por tenant; contenido en Storage (bucket tenant_documents).';

COMMENT ON COLUMN public.documents.storage_path IS
  'Clave dentro del bucket: {tenant_id}/{document_id}/{nombre_seguro}.';

COMMENT ON COLUMN public.documents.index_status IS
  'Fase RAG: pending mientras no hay embeddings; ready cuando indexado o sin pipeline; failed si falló.';

COMMENT ON COLUMN public.documents.index_error IS
  'Detalle legible del fallo de indexación (RAG), si aplica.';

-- updated_at automático
CREATE OR REPLACE FUNCTION public.documents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_set_updated_at ON public.documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.documents_set_updated_at();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;

-- SELECT: cualquier miembro del tenant.
DROP POLICY IF EXISTS documents_select_member ON public.documents;
CREATE POLICY documents_select_member
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = documents.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- INSERT: editor, admin u owner; tenant_id debe coincidir con membresía.
DROP POLICY IF EXISTS documents_insert_editor_plus ON public.documents;
CREATE POLICY documents_insert_editor_plus
  ON public.documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['editor'::text, 'admin'::text, 'owner'::text])
    )
  );

-- UPDATE: mismo rol; requiere SELECT compatible (misma fila visible como miembro).
DROP POLICY IF EXISTS documents_update_editor_plus ON public.documents;
CREATE POLICY documents_update_editor_plus
  ON public.documents
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = documents.tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['editor'::text, 'admin'::text, 'owner'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['editor'::text, 'admin'::text, 'owner'::text])
    )
  );

-- DELETE: editor+ (Fase 3: cualquier doc del tenant; documentar en runbook).
DROP POLICY IF EXISTS documents_delete_editor_plus ON public.documents;
CREATE POLICY documents_delete_editor_plus
  ON public.documents
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = documents.tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['editor'::text, 'admin'::text, 'owner'::text])
    )
  );
