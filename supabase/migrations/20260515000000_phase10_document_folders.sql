-- Fase 10: jerarquía de carpetas para documentos + tools nuevas del agente.
--
-- Añade tabla `document_folders` (árbol anidado, ON DELETE CASCADE sobre subcarpetas).
-- Añade columna `folder_id` a `public.documents` (ON DELETE SET NULL → carpeta raíz).
-- Amplía el CHECK de `agent_steps.step_key` con las tools del agente de archivos.
--
-- Cómo aplicar: docs/operations/10-phase10-folders-and-agent-tools.md

-- ---------------------------------------------------------------------------
-- Tabla public.document_folders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  parent_id  uuid NULL REFERENCES public.document_folders (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índice principal para listar hijos de una carpeta (o raíz del tenant).
CREATE INDEX IF NOT EXISTS document_folders_tenant_parent_idx
  ON public.document_folders (tenant_id, parent_id);

-- Unicidad: no dos carpetas con el mismo nombre (case-insensitive) bajo el mismo padre y tenant.
-- COALESCE trata parent_id NULL como un UUID sentinel para que el índice único funcione.
CREATE UNIQUE INDEX IF NOT EXISTS document_folders_unique_name_in_parent
  ON public.document_folders (
    tenant_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

COMMENT ON TABLE public.document_folders IS
  'Árbol de carpetas por tenant. Raíz = parent_id NULL. ON DELETE CASCADE elimina el subárbol.';

-- updated_at automático
CREATE OR REPLACE FUNCTION public.document_folders_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_folders_set_updated_at ON public.document_folders;
CREATE TRIGGER document_folders_set_updated_at
  BEFORE UPDATE ON public.document_folders
  FOR EACH ROW
  EXECUTE PROCEDURE public.document_folders_set_updated_at();

ALTER TABLE public.document_folders ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folders TO authenticated;
GRANT ALL ON public.document_folders TO service_role;

-- SELECT: cualquier miembro del tenant.
DROP POLICY IF EXISTS document_folders_select_member ON public.document_folders;
CREATE POLICY document_folders_select_member
  ON public.document_folders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = document_folders.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- INSERT: editor, admin u owner.
DROP POLICY IF EXISTS document_folders_insert_editor_plus ON public.document_folders;
CREATE POLICY document_folders_insert_editor_plus
  ON public.document_folders
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

-- UPDATE: editor+.
DROP POLICY IF EXISTS document_folders_update_editor_plus ON public.document_folders;
CREATE POLICY document_folders_update_editor_plus
  ON public.document_folders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = document_folders.tenant_id
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

-- DELETE: editor+.
DROP POLICY IF EXISTS document_folders_delete_editor_plus ON public.document_folders;
CREATE POLICY document_folders_delete_editor_plus
  ON public.document_folders
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = document_folders.tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['editor'::text, 'admin'::text, 'owner'::text])
    )
  );

-- ---------------------------------------------------------------------------
-- Agregar folder_id a public.documents
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS folder_id uuid NULL REFERENCES public.document_folders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_tenant_folder_idx
  ON public.documents (tenant_id, folder_id);

COMMENT ON COLUMN public.documents.folder_id IS
  'Carpeta padre (NULL = raíz del tenant). Se pone NULL si la carpeta se elimina.';

-- ---------------------------------------------------------------------------
-- Ampliar CHECK de agent_steps.step_key con las nuevas tools de archivos
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_step_key_check;

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_step_key_check CHECK (
    step_key = ANY (
      ARRAY[
        'retrieve'::text,
        'generate'::text,
        'rewrite_query'::text,
        'respond_no_context'::text,
        'tool_semantic_search'::text,
        'tool_create_folder'::text,
        'tool_create_document'::text,
        'tool_update_document_content'::text,
        'tool_rename'::text,
        'tool_move'::text,
        'tool_delete_document'::text,
        'tool_delete_folder'::text
      ]
    )
  );
