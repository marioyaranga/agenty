# workyAI API (Flask)

Servicio con `GET /health`, CORS restringido a `WEB_ORIGIN`, **Fase 2:** `GET /v1/me` (JWT Supabase vía JWKS, comprobación opcional de tenant con `service_role`), **Fase 3:** documentos (`/v1/tenants/<tenant_id>/documents`, descarga y borrado) con Storage privado `tenant_documents`, **Fase 4:** RAG (`/v1/tenants/<tenant_id>/rag/query`) y **Fase 5:** agente conversacional (`POST /v1/tenants/<tenant_id>/agent/chat`) con LangGraph, persistencia `agent_runs` / `agent_steps` y LangSmith opcional, **Fase 6:** configuración de IA por tenant (`/v1/tenants/<tenant_id>/settings/ai`) con clave Gemini cifrada (Fernet) y fallback a `GEMINI_API_KEY`, **Fase 7:** grafo con reintentos y `audit_events` + `GET .../audit` (owner/admin), **Fase 8:** notificaciones `in_app_notifications` insertadas desde Flask al terminar indexación Markdown o runs del agente (Realtime en cliente).

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `WEB_ORIGIN` | Origen del front (Vercel), p. ej. `https://tu-proyecto.vercel.app`. Varias URLs separadas por coma. |
| `SUPABASE_URL` | URL del proyecto (JWKS en `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, `iss` del JWT). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor; usada para validar `X-Tenant-Id` contra `tenant_memberships` y para Storage/Postgres con privilegios elevados. Nunca en el cliente. |
| `JWT_AUDIENCE` | Opcional; por defecto `authenticated` (claim `aud` del usuario). |
| `MAX_UPLOAD_BYTES` | Opcional; tamaño máximo de archivo en bytes (por defecto `5242880`). También limita el cuerpo multipart vía `MAX_CONTENT_LENGTH` en la app. |
| `GEMINI_API_KEY` | Embeddings y chat del agente: clave global si el tenant no tiene clave propia (`gemini_keys.py`). |
| `TENANT_SECRETS_FERNET_KEY` | Clave Fernet (base64) para cifrar/descifrar `tenant_ai_settings.gemini_api_key_encrypted`. Obligatoria para **PUT** de `/settings/ai`. |
| `LANGCHAIN_API_KEY` o `LANGSMITH_API_KEY` | Opcional. Si falta, el chat funciona sin LangSmith. |
| `LANGCHAIN_PROJECT` o `LANGSMITH_PROJECT` | Opcional; proyecto LangSmith. |
| `AGENT_MIN_SIMILARITY` | Opcional; umbral mínimo del RPC de chunks (default `0.22`). |
| `AGENT_CONTEXT_OK_MIN_SIMILARITY` | Opcional; similitud mínima del mejor match para aceptar contexto y generar (default `0.24`). |
| `AGENT_MATCH_COUNT` | Opcional; candidatos pedidos al RPC (default `10`). |
| `AGENT_MAX_RETRIEVAL_ATTEMPTS` | Opcional; máximo **2** recuperaciones semánticas por mensaje (default `2`). |

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `GET /v1/me` → Cabecera `Authorization: Bearer <access_token>`. Opcional: `X-Tenant-Id: <uuid>` (membresía verificada en base).
- `POST /v1/tenants/<tenant_id>/documents` → `multipart/form-data` con `title` y `file`. Requiere `Authorization`, `X-Tenant-Id` igual al `tenant_id` de la ruta y rol **editor**, **admin** u **owner**.
- `GET /v1/tenants/<tenant_id>/documents/<id>/download` → descarga del binario; cualquier miembro del tenant.
- `DELETE /v1/tenants/<tenant_id>/documents/<id>` → borra objeto en Storage y fila; rol **editor+**; mismas cabeceras que POST.
- `POST /v1/tenants/<tenant_id>/rag/query` → cuerpo JSON con `query` (y opcionalmente `match_count`, `min_similarity`); cualquier miembro del tenant.
- `POST /v1/tenants/<tenant_id>/agent/chat` → JSON `{ "message": "..." }`; mismas cabeceras que documentos/RAG; cualquier miembro. Respuesta: `run_id`, `answer`, `citations`, `langsmith_trace_id` (opcional), `langsmith_enabled`.
- `GET /v1/tenants/<tenant_id>/audit` → Query `limit` (1–100, default 50) y `cursor` (opaco, siguiente página). **owner** o **admin**; mismas cabeceras. Respuesta: `items`, `next_cursor`.
- `GET /v1/tenants/<tenant_id>/settings/ai` → `{ "gemini_configured": true|false }`; cualquier miembro del tenant.
- `PUT /v1/tenants/<tenant_id>/settings/ai` → JSON `{ "gemini_api_key": "..." }`; **owner** o **admin**; cifrado Fernet en base.
- `DELETE /v1/tenants/<tenant_id>/settings/ai` → quita la clave por tenant (vuelve al fallback `GEMINI_API_KEY`); **owner** o **admin**.

## Local (opcional)

Variables: copiá `apps/api/.env.example` a `.env` si tu herramienta lo carga automáticamente, o exportá las variables antes de arrancar.

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set WEB_ORIGIN=http://localhost:3000
set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=your-service-role
set GEMINI_API_KEY=your-gemini-key
set TENANT_SECRETS_FERNET_KEY=your-fernet-key
flask --app app run
```

## Render (producción)

**Start command** (según [documentación Render para Flask](https://render.com/docs/deploy-flask)):

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

**Build:** `pip install -r requirements.txt`

El blueprint en la raíz del repo (`render.yaml`) usa `rootDir: apps/api` y health check en `/health`.

## Operación Fase 8

Ver `docs/operations/08-phase8-in-app-notifications-realtime.md` (tabla `in_app_notifications`, RLS, campana Realtime en Next).

## Operación Fase 7

Ver `docs/operations/07-phase7-langgraph-audit.md` (migración `agent_steps` / `audit_events`, LangGraph, LangSmith hijos, UI de auditoría).

## Operación Fase 5

Ver `docs/operations/05-phase5-agent-langsmith.md` (migración, RLS, LangSmith, verificación).
