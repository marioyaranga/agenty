# Operación Fase 5 — agente conversacional, LangSmith y tablas `agent_runs` / `agent_steps`

Esta fase añade un flujo mínimo **retrieve → generate** (LangGraph) en el API Flask, persistencia de ejecución por turno en Postgres, UI de chat en Next.js y trazas opcionales en **LangSmith**. No incluye SSE, colas asíncronas ni gestión de claves Gemini por tenant.

---

## 1. Migración SQL

Archivo: `supabase/migrations/20260514150000_phase5_agent_runs.sql`

- **`agent_runs`**: una fila por solicitud de chat (`tenant_id`, `user_id`, `status`, `input_message`, `output_message`, `langsmith_trace_id`, `error`, timestamps). FKs a `tenants` y `auth.users` con `ON DELETE CASCADE`. Trigger `updated_at` en actualizaciones.
- **`agent_steps`**: pasos `retrieve` y `generate` con `payload` JSONB acotado (ids, `heading_path`, `similarity`, snippet corto). FK `run_id` → `agent_runs` con `ON DELETE CASCADE`. Restricción única `(run_id, step_key)`.

### RLS (rol `authenticated`)

| Tabla | SELECT | INSERT |
|-------|--------|--------|
| `agent_runs` | Cualquier **miembro** del tenant (misma regla que `document_chunks`). | **Viewer+**: `owner`, `admin`, `editor`, `viewer`, con `user_id = auth.uid()` y membresía en `tenant_id`. Pensado para coherencia con lecturas directas desde el cliente; el flujo actual crea runs vía Flask con **service_role** (bypass RLS). |
| `agent_steps` | Miembro del tenant vía join con `agent_runs`. | **No** se concede a `authenticated`: los pasos los inserta solo el API (service_role) para evitar payloads falsificados. |

**service_role**: `GRANT ALL` en ambas tablas (comportamiento habitual del backend).

---

## 2. Correlación LangSmith ↔ Postgres

- En el contrato del sistema (`docs/architecture/00-system-contract.md`) se documenta la correlación entre trazas LangSmith y filas en Postgres.
- Columna **`langsmith_trace_id`**: UUID de traza raíz cuando el SDK publica un `RunTree` (requiere clave). Si falla el tracing o no hay clave, el chat **sigue** y el campo puede quedar nulo.

Variables reconocidas (cualquiera basta para activar el cliente LangSmith; ver despliegue):

- `LANGCHAIN_API_KEY` o `LANGSMITH_API_KEY`
- Opcional: `LANGCHAIN_PROJECT` / `LANGSMITH_PROJECT` (nombre de proyecto en LangSmith)

Si estas variables **no** están definidas, no se llama a LangSmith y no se tumba el endpoint.

---

## 3. API Flask

- Blueprint: `routes/agent.py` registrado en `app.py`.
- **POST** `/v1/tenants/<tenant_id>/agent/chat`  
  Cabeceras: `Authorization: Bearer <jwt>`, `X-Tenant-Id` igual al `tenant_id` de la ruta, `Content-Type: application/json`.  
  Cuerpo: `{ "message": "..." }`.  
  Autorización: cualquier rol con membresía en el tenant (igual que `rag/query`).
- Módulo del grafo: `apps/api/agent/` (LangGraph, persistencia, Gemini chat, tracing opcional).
- Recuperación semántica reutiliza `rag/match_chunks.py` → RPC `match_document_chunks` (misma lógica que antes en `documents.py`).
- Modelo de chat: **`gemini-2.0-flash`** con la misma **`GEMINI_API_KEY`** que los embeddings (`rag/embeddings.py`).

Dependencias PyPI (pin en `apps/api/requirements.txt`, verificado en 2026): `langgraph==1.2.0`, `langsmith==0.7.38`.

---

## 4. Next.js

- Ruta: `apps/web/src/app/(app)/chat/page.tsx` + `chat-page-client.tsx`.
- Patrón de llamada: igual que documentos — `NEXT_PUBLIC_API_URL`, Bearer desde `supabase.auth.getSession()`, cabecera `X-Tenant-Id`.
- Enlaces **Chat** en cabeceras de panel y documentos.

---

## 5. Verificación manual sugerida

1. Aplicar la migración en Supabase (SQL Editor o CLI según tu flujo).
2. Configurar en Render: `GEMINI_API_KEY`, variables Supabase existentes; opcional LangSmith.
3. Desde la UI de chat, enviar una pregunta con documentos Markdown ya indexados.
4. Comprobar en Postgres filas en `agent_runs` / `agent_steps` y, si aplica, traza en LangSmith con el mismo UUID que `langsmith_trace_id`.

---

## 6. Fuera de alcance (recordatorio)

Streaming SSE, cola async de agente, UI de clave Gemini por tenant: **no** implementados en esta fase.
