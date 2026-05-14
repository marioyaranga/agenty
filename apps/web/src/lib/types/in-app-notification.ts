/** Fila de `public.in_app_notifications` (lectura cliente con RLS). */

export type InAppNotificationKind =
  | "document_index_ready"
  | "document_index_failed"
  | "agent_chat_completed"
  | "agent_chat_failed";

export type InAppNotificationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  kind: InAppNotificationKind | string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
