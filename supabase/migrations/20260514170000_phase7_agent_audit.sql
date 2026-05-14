-- Fase 7: grafo del agente (pasos ampliados + unicidad por índice), tabla `audit_events`
-- y función de paginación para lecturas desde Flask (service_role).
--
-- Contrato: `agent_steps.step_key` incluye nodos adicionales del grafo LangGraph;
-- unicidad por `(run_id, step_index)` permite múltiples pasos del mismo tipo en un run.
--
-- Cómo aplicar: docs/operations/07-phase7-langgraph-audit.md

-- ---------------------------------------------------------------------------
-- agent_steps: CHECK ampliado, UNIQUE por índice
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_run_step_unique;

DROP INDEX IF EXISTS public.agent_steps_run_idx;

ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_step_key_check;

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_step_key_check CHECK (
    step_key = ANY (
      ARRAY[
        'retrieve'::text,
        'generate'::text,
        'rewrite_query'::text,
        'respond_no_context'::text,
        'tool_semantic_search'::text
      ]
    )
  );

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_run_step_index_unique UNIQUE (run_id, step_index);

CREATE INDEX IF NOT EXISTS agent_steps_run_created_idx
  ON public.agent_steps (run_id, created_at DESC);

COMMENT ON TABLE public.agent_steps IS
  'Pasos del grafo del agente (retrieve, rewrite_query, generate, respond_no_context, tool_semantic_search, etc.) con payload JSON acotado.';

-- ---------------------------------------------------------------------------
-- audit_events (append-only): inserción solo service_role; SELECT vía RLS owner/admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id uuid REFERENCES public.agent_runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_event_type_len CHECK (
    char_length(event_type) > 0 AND char_length(event_type) <= 128
  )
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON public.audit_events (tenant_id, created_at DESC, id DESC);

COMMENT ON TABLE public.audit_events IS
  'Eventos de auditoría append-only (API con service_role). Sin INSERT/UPDATE/DELETE para authenticated; SELECT restringido a owner/admin del tenant.';

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_events FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_events FROM authenticated;
GRANT SELECT ON TABLE public.audit_events TO authenticated;
GRANT ALL ON TABLE public.audit_events TO service_role;

DROP POLICY IF EXISTS audit_events_select_owner_admin ON public.audit_events;
CREATE POLICY audit_events_select_owner_admin
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = audit_events.tenant_id
        AND m.user_id = auth.uid()
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- Paginación estable (keyset) para Flask con service_role (autorización en aplicación).
CREATE OR REPLACE FUNCTION public.list_audit_events_page(
  p_tenant_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS SETOF public.audit_events
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.audit_events
  WHERE tenant_id = p_tenant_id
    AND (
      p_cursor_id IS NULL
      OR p_cursor_created_at IS NULL
      OR (created_at, id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY created_at DESC, id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_audit_events_page(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_audit_events_page(uuid, integer, timestamptz, uuid) TO service_role;
