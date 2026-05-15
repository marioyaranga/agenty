# CLAUDE.md

Este archivo da contexto a Claude Code (claude.ai/code) cuando trabaja en este repositorio.

## Flujo de trabajo (de `.cursor/rules/deploy-y-pruebas.mdc`)

**No hay entorno local de uso habitual** ni staging. El producto se prueba solo contra el stack desplegado:

- Web (Vercel): https://agenty-delta.vercel.app/
- API (Render): servicio `workyai-api`, blueprint en `render.yaml`
- DB / Auth / Storage / Realtime: Supabase

Al terminar un cambio, hacé push a `main` para que el entorno desplegado lo levante, y verificá con las CLIs y logs de Vercel / Render / Supabase. Mantené diffs chicos — no hay staging que absorba errores.

## Estructura del repo

Monorepo de dos apps, sin tooling de workspace en la raíz:

| Ruta | Qué es |
|------|--------|
| `apps/web/` | Frontend Next.js 16 + React 19 (App Router, TS, `src/`, Tailwind v4, shadcn/ui). Despliega en Vercel con el root del proyecto en `apps/web`. |
| `apps/api/` | API Flask 3 + Gunicorn. Despliega en Render vía `render.yaml` (`rootDir: apps/api`, health check `/health`). |
| `supabase/migrations/` | Migraciones SQL, una por fase. Se aplican en orden; el nombre codifica timestamp + fase. |
| `docs/architecture/00-system-contract.md` | **Léelo primero.** Contrato autoritativo: tenants, roles, decisiones de RAG v1, requisitos de validación JWT, fronteras de secretos. |
| `docs/operations/0X-phase*.md` | Runbooks operativos por fase (fases 1–8). Al tocar una funcionalidad, el doc de su fase explica migraciones, RLS, variables de entorno y pasos de verificación. |

Cada app tiene su propio README con variables y comandos; no se duplican aquí.

## Comandos

### Web (`apps/web/`)

```bash
npm install
npm run dev      # next dev
npm run build    # next build
npm run lint     # eslint
```

### API (`apps/api/`)

```bash
python -m venv .venv
.venv\Scripts\activate           # Windows
pip install -r requirements.txt
flask --app app run              # desarrollo local
gunicorn app:app --bind 0.0.0.0:$PORT   # comando que usa Render
```

Por ahora **no hay suite de tests** en ninguna app. La API **no tiene linter** (sin config de ruff/mypy) — seguí el estilo existente leyendo archivos vecinos.

### Advertencia Next.js 16

`apps/web/AGENTS.md` (referenciado desde `apps/web/CLAUDE.md`) avisa que este es Next 16 con breaking changes respecto a versiones anteriores. Antes de escribir código de Next.js, consultá los docs incluidos en `apps/web/node_modules/next/dist/docs/` en vez de confiar en la memoria de convenciones viejas de Next.

## Arquitectura

El flujo es: **Usuario → Next en Vercel → Supabase Auth → Flask en Render (Bearer JWT) → Postgres (RLS) / Storage / pgvector / Gemini / LangSmith.** Ver el mermaid en `docs/architecture/00-system-contract.md` §2.

### Auth y tenancy (transversal — afecta a casi todo cambio en la API)

Cada endpoint Flask con privilegios sigue el mismo patrón, centralizado en `apps/api/tenant_http.py`:

1. `require_bearer_jwt()` — valida un JWT Supabase vía JWKS (`auth_jwt.py`), exigiendo `iss`, `aud` (por defecto `authenticated`), `exp` y `role == "authenticated"`.
2. `require_matching_tenant_header(tenant_id)` — la cabecera `X-Tenant-Id` debe coincidir con el `tenant_id` de la ruta.
3. `membership_role(client, tenant_id, user_id)` contra `tenant_memberships` — devuelve `owner` / `admin` / `editor` / `viewer` o `None`.
4. Gate de rol específico del endpoint (p. ej. `require_owner_or_admin`, o editor+ para escrituras).

Al agregar una ruta nueva scopeada a tenant, reusá estos helpers y los blueprints existentes en `routes/` como plantilla (`documents.py`, `agent.py`, `audit.py`, `settings_ai.py`, `v1.py`). Todos los blueprints se registran en `app.py::create_app()`. La lista de orígenes CORS sale de `WEB_ORIGIN` (separados por coma).

El lado Next envía el JWT como `Authorization: Bearer …` más `X-Tenant-Id`. El acceso a Supabase desde el servidor usa `@supabase/ssr` con refresh de sesión por cookies en `apps/web/src/middleware.ts`; el grupo de rutas `(app)` impone auth en su `layout.tsx`.

### Frontera de service_role

`SUPABASE_SERVICE_ROLE_KEY` se usa **solo** dentro de Flask (`tenant_http.admin_supabase_client`) para chequeos de membresía, Storage e inserts en tablas sin política `authenticated` (p. ej. `audit_events`, `in_app_notifications`). Nunca debe filtrarse a `NEXT_PUBLIC_*` ni a ningún bundle cliente. Incluso con service_role, Flask **debe aplicar autorización explícita** — saltarse RLS sin chequeos de rol/tenant es la forma canónica en que este diseño falla.

### Pipeline de agente / RAG (fases 4–7)

- La indexación es **síncrona dentro del request** (S1 del contrato). Si falla el embedding, marcá el documento `index_status = failed` con mensaje explícito — no trunques en silencio.
- Chunking por encabezados Markdown; embeddings vía `gemini-embedding-001` a 1536 dims en pgvector. Código en `apps/api/rag/` (`chunk_markdown.py`, `embeddings.py`, `index_document.py`, `match_chunks.py`).
- El endpoint de chat (`POST /v1/tenants/<id>/agent/chat`) corre una máquina de estados **LangGraph** en `apps/api/agent/graph.py` con ramas condicionales: retrieve → (opcionalmente rewrite y reintentar hasta `AGENT_MAX_RETRIEVAL_ATTEMPTS`, por defecto 2) → generate. Cada nodo persiste una fila `agent_steps` (par `(run_id, step_index)` único) y, si LangSmith está configurado, se ejecuta como span hijo bajo el run raíz publicado por la ruta de chat. Ver `agent/tracing.py` para los helpers `optional_langsmith_root` / `traced_graph_node`.
- Resolución de clave Gemini por tenant: `gemini_keys.get_gemini_api_key_for_tenant` lee `tenant_ai_settings.gemini_api_key_encrypted` (Fernet vía `TENANT_SECRETS_FERNET_KEY`) y cae al `GEMINI_API_KEY` global. `PUT /v1/tenants/<id>/settings/ai` requiere que `TENANT_SECRETS_FERNET_KEY` esté seteada.
- Al terminar un run (éxito o fallo), `notifications.notify_agent_chat_outcome` inserta en `in_app_notifications`. La misma tabla la alimenta también la finalización de indexación de documentos. El cliente Next se suscribe vía Supabase Realtime con `postgres_changes` (`components/in-app-notifications-host.tsx`, montado desde `app/(app)/layout.tsx`).
- `audit_events` es append-only; solo la API (con service_role) inserta. `GET /v1/tenants/<id>/audit` está restringido a owner/admin y soporta paginación con `limit` + `cursor` opaco.

### Migraciones

`supabase/migrations/` es SQL plano que se aplica en orden de nombre vía la CLI / dashboard de Supabase. Cada migración se corresponde 1:1 con un doc de fase — al agregar una migración, actualizá o creá también el `docs/operations/0X-phase*.md` que describe la postura de RLS y los pasos de verificación. Las decisiones de política RLS (quién puede SELECT/INSERT/UPDATE qué filas) son la parte sustantiva — no mandes una migración sin pensarlas.

### Dónde los docs de fase son críticos

Los docs de fase no son lectura opcional cuando trabajás en su área — codifican el razonamiento de RLS y los pasos operativos que no se ven en el SQL solo. Antes de cambiar algo, ubicá la fase de la funcionalidad:

| Fase | Tema | Doc |
|------|------|-----|
| 1 | Deploy inicial (cableado Vercel + Render + Supabase) | `docs/operations/01-phase1-deploy.md` |
| 2 | Auth SSR, tenants, validación JWT en Flask | `02-phase2-auth-tenant.md` |
| 3 | Documentos + bucket privado de Storage `tenant_documents` | `03-phase3-documents-storage.md` |
| 4 | RAG con pgvector | `04-phase4-rag-pgvector.md` |
| 5 | Agente conversacional + LangSmith | `05-phase5-agent-langsmith.md` |
| 6 | Clave Gemini por tenant (Fernet) | `06-phase6-tenant-gemini-key.md` |
| 7 | Routing LangGraph + `audit_events` | `07-phase7-langgraph-audit.md` |
| 8 | Notificaciones in-app + Realtime | `08-phase8-in-app-notifications-realtime.md` |
