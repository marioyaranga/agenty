# Fase 7 — Grafo LangGraph (routing / rewrite / retry), LangSmith hijos y auditoría

Esta fase amplía el agente conversacional, la persistencia de pasos, el tracing en LangSmith y añade la tabla append-only `audit_events` con lectura paginada para **owner** y **admin**.

## Migración SQL

Archivo: `supabase/migrations/20260514170000_phase7_agent_audit.sql`

- `agent_steps`: `step_key` admite `retrieve`, `generate`, `rewrite_query`, `respond_no_context`, `tool_semantic_search`; se elimina `UNIQUE (run_id, step_key)` y se define `UNIQUE (run_id, step_index)`; índice auxiliar `(run_id, created_at DESC)`.
- `audit_events`: FKs a `tenants`, `auth.users` (`actor_user_id`) y opcionalmente `agent_runs`; RLS **SELECT** solo si la membresía es **owner** o **admin**; sin **INSERT/UPDATE/DELETE** para `authenticated`; **GRANT ALL** a `service_role`.
- Función `list_audit_events_page(p_tenant_id, p_limit, p_cursor_created_at, p_cursor_id)` para paginación estable (keyset); solo `service_role` tiene `EXECUTE` (el API valida JWT y rol antes de llamar con `service_role`).

Aplicación: `supabase db push` o flujo de migraciones del proyecto.

## API Flask

- Grafo (`agent/graph.py`): ramas condicionales tras `retrieve`; nodo `rewrite_query` (Gemini) antes del segundo intento; `respond_no_context` si tras hasta **dos** recuperaciones no hay contexto útil; umbrales vía variables de entorno opcionales:
  - `AGENT_MIN_SIMILARITY` (RPC, default `0.22`)
  - `AGENT_CONTEXT_OK_MIN_SIMILARITY` (decisión de “contexto útil”, default `0.24`)
  - `AGENT_MATCH_COUNT` (default `10`)
  - `AGENT_MAX_RETRIEVAL_ATTEMPTS` (máximo `2`, default `2`)
- `insert_agent_step` usa `step_index` monótono por ejecución del grafo.
- `agent/tracing.py`: spans hijos `RunTree` bajo el run raíz por nodo; errores de tracing no interrumpen el chat.
- `audit_log.record_audit`: insert best-effort desde rutas mutantes.
- `GET /v1/tenants/<tenant_id>/audit?limit=&cursor=` (owner/admin): respuesta `{ "items": [...], "next_cursor": "<opaque>|null" }`.

## Front (Next)

- Ruta `src/app/(app)/audit/page.tsx` y cliente que llama al API con JWT + `X-Tenant-Id`.
- Enlaces **Auditoría** en cabeceras cuando el usuario tiene al menos un tenant con rol owner o admin (mismo criterio que la visibilidad operativa de settings sensibles).

## Verificación local

1. Aplicar migración Fase 7 en Supabase.
2. API: `python -c "from app import app; print(app.url_map)"` desde `apps/api` (con variables mínimas si hace falta).
3. Web: `npm run build` en `apps/web`.

## Correlación

- `agent_runs.langsmith_trace_id` sigue enlazando la traza raíz; los spans hijos aparecen bajo esa raíz en LangSmith cuando hay API key configurada.
