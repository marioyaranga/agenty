# Fase 9 — Threads de conversación del agente

Objetivo: agrupar los turnos de chat (`agent_runs`) en conversaciones persistentes (`agent_threads`), habilitar el historial multi-turno en la UI y guardar las citations directamente en `agent_runs` para recuperarlas sin reconstruir desde `agent_steps`.

## Modelo de datos

### `public.agent_threads`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid FK | → `tenants(id)` ON DELETE CASCADE |
| `user_id` | uuid FK | → `auth.users(id)` ON DELETE CASCADE |
| `title` | text | Default `'Nueva conversación'`, máx 200 chars |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | Trigger `agent_threads_set_updated_at` en cada UPDATE |

Índice `agent_threads_tenant_user_updated_idx (tenant_id, user_id, updated_at DESC)` — soporta la paginación keyset de la RPC.

### Cambios en `public.agent_runs`

Dos columnas nuevas (ambas retrocompatibles con runs anteriores):

- `thread_id uuid NULL REFERENCES agent_threads(id) ON DELETE CASCADE` — `NULL` en runs históricos (previos a Fase 9).
- `citations jsonb NOT NULL DEFAULT '[]'::jsonb` — fragmentos recuperados por el agente.

Índice parcial `agent_runs_thread_created_idx (thread_id, created_at ASC) WHERE thread_id IS NOT NULL` — permite listar los runs de un thread en orden cronológico de forma eficiente.

## Seguridad (RLS)

### `agent_threads`

- **SELECT**: solo el dueño del thread (`user_id = auth.uid()`) y además debe ser miembro del tenant. Un miembro del tenant NO ve los threads de otros usuarios del mismo tenant.
- **INSERT / UPDATE / DELETE**: sin políticas para `authenticated`; solo el API Flask con `service_role` puede mutarlos.
- `REVOKE ALL FROM PUBLIC`; `GRANT SELECT TO authenticated`; `GRANT ALL TO service_role`.

### `agent_runs` (sin cambios en RLS)

Las políticas existentes de Fase 5 (`agent_runs_select_member`, `agent_runs_insert_viewer_plus`) no se modifican. El campo `thread_id` y `citations` simplemente estarán visibles para los miembros del tenant que ya pueden SELECT sobre `agent_runs`.

## RPC de paginación

```sql
list_agent_threads_page(
  p_tenant_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_cursor_updated_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
) RETURNS SETOF public.agent_threads
```

Ordena por `(updated_at DESC, id DESC)` — el thread con actividad más reciente primero. El cursor opaco que devuelve el API Flask codifica `{c: updated_at, i: id}` (ver `apps/api/cursor.py`). Solo ejecutable con `service_role`.

## Endpoints Flask (Fase 9)

Ver `apps/api/routes/agent.py`:

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/tenants/<id>/agent/threads` | Crea thread nuevo |
| `GET` | `/v1/tenants/<id>/agent/threads` | Lista threads del usuario (paginado) |
| `GET` | `/v1/tenants/<id>/agent/threads/<tid>` | Thread + runs ordenados |
| `PATCH` | `/v1/tenants/<id>/agent/threads/<tid>` | Renombra (solo dueño) |
| `DELETE` | `/v1/tenants/<id>/agent/threads/<tid>` | Borra thread + runs (cascade) |
| `POST` | `/v1/tenants/<id>/agent/chat` | Chat; acepta `thread_id` opcional; crea thread si falta |

## Variables de entorno

Sin variables nuevas. Los endpoints reusan `SUPABASE_SERVICE_ROLE_KEY` (ya configurada) y la autenticación JWT existente.

## Cómo aplicar

```bash
supabase db push
# o desde el dashboard: copiar el contenido de
# supabase/migrations/20260514220000_phase9_agent_threads.sql y ejecutarlo
```

## Pasos de verificación

```sql
-- 1. Tabla y columnas nuevas
\d public.agent_threads
\d public.agent_runs  -- debe mostrar thread_id y citations

-- 2. Índices
SELECT indexname FROM pg_indexes WHERE tablename IN ('agent_threads','agent_runs')
  AND indexname LIKE '%thread%';

-- 3. RLS activada
SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'agent_threads';

-- 4. Política de aislamiento por usuario
-- Como usuario A del tenant T, hacer SELECT sobre threads de usuario B del mismo tenant → 0 filas.

-- 5. RPC accesible con service_role
SELECT count(*) FROM list_agent_threads_page(
  '<tenant_id>'::uuid, '<user_id>'::uuid, 20
);
```

```bash
# 6. API smoke (Bearer = token JWT válido)
curl -s -X POST https://workyai-api.onrender.com/v1/tenants/<tid>/agent/threads \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: <tid>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Mi primer thread"}' | jq .

curl -s https://workyai-api.onrender.com/v1/tenants/<tid>/agent/threads \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: <tid>" | jq .

curl -s -X POST https://workyai-api.onrender.com/v1/tenants/<tid>/agent/chat \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: <tid>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hola","thread_id":"<id>"}' | jq .thread_id
```
