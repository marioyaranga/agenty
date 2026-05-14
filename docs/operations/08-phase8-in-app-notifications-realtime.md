# Fase 8 — Notificaciones in-app y Realtime

Objetivo: avisar en la app al usuario autenticado cuando terminan acciones relevantes (indexación Markdown del documento que él creó; run del agente de chat completado o fallido), sin exponer `service_role` al navegador.

## Modelo de datos (`public.in_app_notifications`)

- **Campos principales**: `tenant_id`, `user_id` (destinatario), `kind` (CHECK), `title`, `body`, `metadata` (JSON para enlaces), `read_at`, `created_at`.
- **Kinds** permitidos: `document_index_ready`, `document_index_failed`, `agent_chat_completed`, `agent_chat_failed`.
- **Índices**: por `(tenant_id, user_id, created_at)` y parcial por no leídas (`read_at IS NULL`).

## Seguridad (RLS)

- **INSERT / DELETE**: no hay políticas para `authenticated`; además se revocan permisos de inserción/borrado. Solo el **API Flask** con `SUPABASE_SERVICE_ROLE_KEY` inserta filas.
- **SELECT / UPDATE**: el usuario debe ser **destinatario** (`user_id = auth.uid()`) y **miembro** del `tenant_id` de la fila.
- El cliente Next usa la **clave anon** + sesión; las políticas filtran lo que puede verse o marcarse como leído.

## Realtime

La migración ejecuta `ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications`.

Si en un proyecto antiguo o self-hosted falla (nombre de publicación distinto o tabla ya publicada), revisá la documentación de vuestra versión o habilitá la réplica desde **Supabase Dashboard → Database → Publications / Replication** para esa tabla.

El front se suscribe a `postgres_changes` (`INSERT` y opcionalmente `UPDATE` cuando se marca `read_at`) con filtro `user_id=eq.<uuid>`.

## Backend (Flask)

- Módulo `apps/api/notifications.py`: `insert_notification` y helpers `notify_document_index_outcome` / `notify_agent_chat_outcome`.
- **Documentos**: tras indexación síncrona Markdown en **alta** (solo si corrió el pipeline `pending`) y en **reindex**, se notifica al `created_by` con estado `ready` o `failed`.
- **Agente**: tras `agent.chat` completado o fallido, se notifica al `user_id` del JWT.

Los errores de inserción se loguean y **no** cortan la respuesta HTTP del endpoint principal.

## Frontend (Next)

- `InAppNotificationsHost` en `(app)/layout` recibe `userId` del servidor.
- Campana fija (esquina), lista inicial vía `select`, actualización en vivo vía canal Realtime, acciones **marcar leída** / **marcar leídas** con `update` de `read_at`.
- Enlaces a `/documents` o `/chat` según `metadata.link`; antes de navegar se sincroniza `localStorage` `workyai_active_tenant_id` con `metadata.tenant_id` para alinear el espacio activo con el resto de pantallas.

## Migración

Archivo: `supabase/migrations/20260514180000_phase8_in_app_notifications.sql`.

Aplicar con el flujo habitual del proyecto (CLI Supabase o SQL editor en producción única documentada en el contrato del sistema).
