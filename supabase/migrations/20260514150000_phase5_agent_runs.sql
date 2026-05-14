-- Fase 5: ejecuciones del agente conversacional + pasos (retrieve/generate) y correlación LangSmith.
--
-- Contrato (ver docs/architecture/00-system-contract.md): `langsmith_trace_id` en `agent_runs`
-- enlaza la traza raíz en LangSmith con el registro en Postgres para depuración y auditoría.
--
-- RLS: lectura para cualquier miembro del tenant (misma convención que `document_chunks`).
-- INSERT en `agent_runs`: **viewer+** (owner, admin, editor, viewer) — habilita escrituras directas
-- desde el cliente Supabase si el producto lo requiere; el flujo actual crea runs vía Flask
-- (service_role, bypass RLS). Ver runbook: docs/operations/05-phase5-agent-langsmith.md
--
-- `agent_steps`: solo INSERT desde el API (service_role). No se concede INSERT a `authenticated`
-- para evitar pasos falsificados sin el run correspondiente validado por el servidor.
--
-- Cómo aplicar: docs/operations/05-phase5-agent-langsmith.md

-- ---------------------------------------------------------------------------
-- Tabla public.agent_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running'::text
    CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])),
  input_message text NOT NULL,
  output_message text,
  langsmith_trace_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_tenant_created_idx
  ON public.agent_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_user_created_idx
  ON public.agent_runs (user_id, created_at DESC);

COMMENT ON TABLE public.agent_runs IS
  'Una ejecución de chat del agente por tenant y usuario; correlacionable con LangSmith.';

COMMENT ON COLUMN public.agent_runs.langsmith_trace_id IS
  'Identificador de traza LangSmith (UUID de la raíz del run) cuando el tracing está activo; ver contrato Fase 0.';

COMMENT ON COLUMN public.agent_runs.status IS
  'running: en curso; completed: respuesta persistida; failed: error controlado.';

CREATE OR REPLACE FUNCTION public.agent_runs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_runs_set_updated_at ON public.agent_runs;
CREATE TRIGGER agent_runs_set_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.agent_runs_set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabla public.agent_steps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs (id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (step_key = ANY (ARRAY['retrieve'::text, 'generate'::text])),
  step_index integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_steps_run_step_unique UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS agent_steps_run_idx ON public.agent_steps (run_id, step_index);

COMMENT ON TABLE public.agent_steps IS
  'Pasos atómicos del grafo (retrieve / generate) con payload JSON acotado para auditoría.';

COMMENT ON COLUMN public.agent_steps.payload IS
  'Metadatos estructurados (ids, heading_path, similarity, snippet corto); sin cuerpos completos.';

-- ---------------------------------------------------------------------------
-- RLS + privilegios
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_steps FROM PUBLIC;

GRANT SELECT, INSERT ON public.agent_runs TO authenticated;
GRANT SELECT ON public.agent_steps TO authenticated;

GRANT ALL ON TABLE public.agent_runs TO service_role;
GRANT ALL ON TABLE public.agent_steps TO service_role;

-- SELECT runs: miembros del tenant.
DROP POLICY IF EXISTS agent_runs_select_member ON public.agent_runs;
CREATE POLICY agent_runs_select_member
  ON public.agent_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = agent_runs.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- INSERT runs: viewer+ (todos los roles con membresía activa en el tenant).
DROP POLICY IF EXISTS agent_runs_insert_viewer_plus ON public.agent_runs;
CREATE POLICY agent_runs_insert_viewer_plus
  ON public.agent_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (
          ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'viewer'::text]
        )
    )
  );

-- SELECT steps: miembros del tenant vía el run padre.
DROP POLICY IF EXISTS agent_steps_select_member ON public.agent_steps;
CREATE POLICY agent_steps_select_member
  ON public.agent_steps
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_runs r
      JOIN public.tenant_memberships m ON m.tenant_id = r.tenant_id
      WHERE r.id = agent_steps.run_id
        AND m.user_id = auth.uid()
    )
  );
