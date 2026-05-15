-- Fase 9: threads de conversación para el agente de chat.
--
-- Cada thread agrupa varios agent_runs (turnos de la misma conversación).
-- Las citations del run se guardan como jsonb en agent_runs para recuperarlas
-- sin reconstruir desde agent_steps.
--
-- RLS: SELECT para miembros del tenant; INSERT/UPDATE/DELETE solo service_role.
--      El usuario solo ve sus propios threads (política filtra por user_id además de tenant_id).
--
-- Cómo aplicar: docs/operations/09-phase9-agent-threads.md

-- ---------------------------------------------------------------------------
-- Tabla public.agent_threads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nueva conversación'
    CONSTRAINT agent_threads_title_len CHECK (char_length(title) > 0 AND char_length(title) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_threads_tenant_user_updated_idx
  ON public.agent_threads (tenant_id, user_id, updated_at DESC);

COMMENT ON TABLE public.agent_threads IS
  'Conversación multi-turno del agente; agrupa agent_runs del mismo hilo.';

CREATE OR REPLACE FUNCTION public.agent_threads_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_threads_set_updated_at ON public.agent_threads;
CREATE TRIGGER agent_threads_set_updated_at
  BEFORE UPDATE ON public.agent_threads
  FOR EACH ROW
  EXECUTE PROCEDURE public.agent_threads_set_updated_at();

-- ---------------------------------------------------------------------------
-- Ampliar agent_runs: thread_id + citations
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS thread_id uuid
    REFERENCES public.agent_threads (id) ON DELETE CASCADE;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS agent_runs_thread_created_idx
  ON public.agent_runs (thread_id, created_at ASC)
  WHERE thread_id IS NOT NULL;

COMMENT ON COLUMN public.agent_runs.thread_id IS
  'Thread al que pertenece este run; NULL para runs anteriores a Fase 9.';

COMMENT ON COLUMN public.agent_runs.citations IS
  'Fragmentos recuperados por el agente (jsonb); poblado por finalize_agent_run.';

-- ---------------------------------------------------------------------------
-- RLS + privilegios agent_threads
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_threads FROM PUBLIC;
GRANT SELECT ON TABLE public.agent_threads TO authenticated;
GRANT ALL ON TABLE public.agent_threads TO service_role;

-- SELECT: el usuario solo ve sus propios threads y debe ser miembro del tenant.
DROP POLICY IF EXISTS agent_threads_select_own ON public.agent_threads;
CREATE POLICY agent_threads_select_own
  ON public.agent_threads
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = agent_threads.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RPC de paginación keyset para Flask (service_role)
-- Ordena por (updated_at DESC, id DESC) — threads más activos primero.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_agent_threads_page(
  p_tenant_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_cursor_updated_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS SETOF public.agent_threads
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.agent_threads
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND (
      p_cursor_id IS NULL
      OR p_cursor_updated_at IS NULL
      OR (updated_at, id) < (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY updated_at DESC, id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_agent_threads_page(uuid, uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agent_threads_page(uuid, uuid, integer, timestamptz, uuid) TO service_role;
