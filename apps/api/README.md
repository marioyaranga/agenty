# workyAI API (Flask)

Servicio con `GET /health`, CORS restringido a `WEB_ORIGIN`, **Fase 2:** `GET /v1/me` (JWT Supabase vía JWKS, comprobación opcional de tenant con `service_role`), **Fase 3:** documentos (`/v1/tenants/<tenant_id>/documents`, descarga y borrado) con Storage privado `tenant_documents`, **Fase 4:** RAG (`/v1/tenants/<tenant_id>/rag/query`) y **Fase 5:** agente conversacional (`POST /v1/tenants/<tenant_id>/agent/chat`) con LangGraph, persistencia `agent_runs` / `agent_steps` y LangSmith opcional.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `WEB_ORIGIN` | Origen del front (Vercel), p. ej. `https://tu-proyecto.vercel.app`. Varias URLs separadas por coma. |
| `SUPABASE_URL` | URL del proyecto (JWKS en `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, `iss` del JWT). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor; usada para validar `X-Tenant-Id` contra `tenant_memberships` y para Storage/Postgres con privilegios elevados. Nunca en el cliente. |
| `JWT_AUDIENCE` | Opcional; por defecto `authenticated` (claim `aud` del usuario). |
| `MAX_UPLOAD_BYTES` | Opcional; tamaño máximo de archivo en bytes (por defecto `5242880`). También limita el cuerpo multipart vía `MAX_CONTENT_LENGTH` en la app. |
| `GEMINI_API_KEY` | Embeddings (`rag/embeddings.py`) y chat del agente Fase 5 (`agent/gemini_rag.py`). |
| `LANGCHAIN_API_KEY` o `LANGSMITH_API_KEY` | Opcional. Si falta, el chat funciona sin LangSmith. |
| `LANGCHAIN_PROJECT` o `LANGSMITH_PROJECT` | Opcional; proyecto LangSmith. |

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `GET /v1/me` → Cabecera `Authorization: Bearer <access_token>`. Opcional: `X-Tenant-Id: <uuid>` (membresía verificada en base).
- `POST /v1/tenants/<tenant_id>/documents` → `multipart/form-data` con `title` y `file`. Requiere `Authorization`, `X-Tenant-Id` igual al `tenant_id` de la ruta y rol **editor**, **admin** u **owner**.
- `GET /v1/tenants/<tenant_id>/documents/<id>/download` → descarga del binario; cualquier miembro del tenant.
- `DELETE /v1/tenants/<tenant_id>/documents/<id>` → borra objeto en Storage y fila; rol **editor+**; mismas cabeceras que POST.
- `POST /v1/tenants/<tenant_id>/rag/query` → cuerpo JSON con `query` (y opcionalmente `match_count`, `min_similarity`); cualquier miembro del tenant.
- `POST /v1/tenants/<tenant_id>/agent/chat` → JSON `{ "message": "..." }`; mismas cabeceras que documentos/RAG; cualquier miembro. Respuesta: `run_id`, `answer`, `citations`, `langsmith_trace_id` (opcional), `langsmith_enabled`.

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
flask --app app run
```

## Render (producción)

**Start command** (según [documentación Render para Flask](https://render.com/docs/deploy-flask)):

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

**Build:** `pip install -r requirements.txt`

El blueprint en la raíz del repo (`render.yaml`) usa `rootDir: apps/api` y health check en `/health`.

## Operación Fase 5

Ver `docs/operations/05-phase5-agent-langsmith.md` (migración, RLS, LangSmith, verificación).
