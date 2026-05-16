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
- **POST** `/v1/tenants/<tenant_id>/agent/chat` (SSE `text/event-stream`)  
  Cabeceras: `Authorization: Bearer <jwt>`, `X-Tenant-Id` igual al `tenant_id` de la ruta, `Content-Type: application/json`.  
  Cuerpo: `{ "message": "...", "thread_id?": "uuid", "mentions?": [...] }`.  
  Autorización: cualquier rol con membresía en el tenant (igual que `rag/query`).

### Contrato SSE (líneas `data: {json}`)

| `type` | Cuándo | Campos principales |
|--------|--------|-------------------|
| `ack` | Reconocimiento rápido (Gemini) | `text` |
| `started` | Run creado | `run_id`, `thread_id` |
| `step` | Nodo LangGraph | `node`, `label`, `description`, `status`: `running` \| `done` |
| `tool` | Herramienta invocada | `tool_name`, `label`, `description`, `status`: `running` \| `done`, `ok?`, `detail?` |
| `done` | Respuesta final | `answer`, `citations`, `steps[]`, `run_id`, `thread_id`, `langsmith_*` |
| `error` | Fallo | `detail`, `run_id?`, `thread_id?` |

El array **`steps`** del evento `done` y de **GET** `/v1/tenants/<tenant_id>/agent/threads/<thread_id>` (campo `runs[].steps`) usa el formateador unificado `agent/agent_steps_ui.format_agent_steps_for_ui`: objetos con `id`, `kind` (`graph` \| `tool` \| `seo`), `label`, `description`, `status` (`completed` en histórico), `detail` (string corto), `step_index`, `tool_name?`. Los payloads persistidos se **sanitizan** en el API: sin cuerpos de documentos, claves API ni JSON grande.

**GET thread:** tras cargar `agent_runs`, una consulta batch a `agent_steps` por `run_id` rellena `steps` por run (sin migración SQL adicional).
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
3. **Chat RAG:** en `/chat`, enviar una pregunta con documentos indexados; en el panel «Pasos del agente» deben verse nodos `retrieve` / `generate` en vivo y permanecer tras el `done`.
4. **Tools de archivos:** pedir leer o listar un documento; debe aparecer una fila `kind: tool` con `tool_name` (p. ej. `read_document`) y `detail` acotado (título/id, sin cuerpo).
5. **SEO:** consulta de volumen/SERP; fases DataForSEO (`kind: seo`) sin regresión.
6. **Hilo persistido:** reabrir conversación desde el sidebar; pasos visibles en cada mensaje assistant sin re-ejecutar.
7. **API:** `GET /v1/tenants/{id}/agent/threads/{thread_id}` devuelve `runs[].steps` no vacío en runs completados con pasos.
8. Comprobar en Postgres filas en `agent_runs` / `agent_steps` y, si aplica, traza LangSmith con el mismo UUID que `langsmith_trace_id`.
9. Post-deploy: `vercel ls` (proyecto `apps/web`), health Render `GET /health` en `workyai-api`.

---

## 6. Fuera de alcance (recordatorio)

Cola async de agente, enlace LangSmith en UI, streaming token a token de la respuesta: **no** en esta fase. SSE de pasos del agente y panel en chat **sí** (ver contrato arriba).
