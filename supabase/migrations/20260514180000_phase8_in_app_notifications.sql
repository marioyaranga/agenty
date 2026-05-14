-- Fase 8: notificaciones in-app por usuario/tenant, RLS (destinatario + membresía),
-- inserción solo vía service_role (Flask), Realtime en `supabase_realtime`.
--
-- Cómo aplicar: docs/operations/08-phase8-in-app-notifications-realtime.md

-- ---------------------------------------------------------------------------
-- Tabla public.in_app_notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT in_app_notifications_kind_check CHECK (
    kind = ANY (
      ARRAY[
        'document_index_ready'::text,
        'document_index_failed'::text,
        'agent_chat_completed'::text,
        'agent_chat_failed'::text
      ]
    )
  ),
  CONSTRAINT in_app_notifications_title_len CHECK (
    char_length(title) > 0 AND char_length(title) <= 500
  )
);

CREATE INDEX IF NOT EXISTS in_app_notifications_tenant_user_created_idx
  ON public.in_app_notifications (tenant_id, user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS in_app_notifications_user_unread_idx
  ON public.in_app_notifications (user_id, read_at)
  WHERE read_at IS NULL;

COMMENT ON TABLE public.in_app_notifications IS
  'Notificaciones producto por destinatario y tenant. INSERT solo service_role (API); lectura/lectura+marca leído por el usuario destinatario miembro del tenant.';

COMMENT ON COLUMN public.in_app_notifications.metadata IS
  'JSON libre (p. ej. document_id, run_id, tenant_id) para deep links en la app.';

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.in_app_notifications FROM PUBLIC;
REVOKE ALL ON TABLE public.in_app_notifications FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.in_app_notifications TO authenticated;
GRANT ALL ON TABLE public.in_app_notifications TO service_role;

DROP POLICY IF EXISTS in_app_notifications_select_recipient_member
  ON public.in_app_notifications;
CREATE POLICY in_app_notifications_select_recipient_member
  ON public.in_app_notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = in_app_notifications.tenant_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS in_app_notifications_update_recipient_member
  ON public.in_app_notifications;
CREATE POLICY in_app_notifications_update_recipient_member
  ON public.in_app_notifications
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = in_app_notifications.tenant_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships m
      WHERE m.tenant_id = in_app_notifications.tenant_id
        AND m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: agregar tabla a la publicación estándar de Supabase
-- ---------------------------------------------------------------------------
-- Nota: en proyectos Supabase antiguos o self-hosted puede no existir la
-- publicación `supabase_realtime` o el nombre puede variar; si este paso falla,
-- habilitá Realtime para la tabla desde el Dashboard (Database → Replication)
-- o cread la publicación acorde a vuestra versión.
ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications;
