# Fase 4 — RAG v1 (pgvector + Gemini + indexación S1)

Esta fase añade `public.document_chunks` con embeddings **1536** (modelo **`gemini-embedding-001`**), índice vectorial **HNSW coseno** (con alternativa **IVFFlat** documentada en la migración), **RLS** de solo lectura para `authenticated`, y la RPC **`match_document_chunks`** (solo **`service_role`** / backend).

La **indexación síncrona (S1)** ocurre en Flask al crear un documento **Markdown** real (`text/markdown`, `text/x-markdown`): tras la subida exitosa a Storage y el `INSERT` en `public.documents`, el API intenta generar embeddings y persistir chunks antes de responder **201**. Los **HTML** ya no quedan en `pending` sin pipeline: se marcan **`ready`** (no requieren pgvector en v1).

## 1. Aplicar la migración SQL (SQL Editor)

1. En **Supabase Dashboard** → **SQL Editor** → nueva consulta.
2. Pegá el contenido completo de  
   `supabase/migrations/20260514140000_phase4_rag_chunks.sql`
3. Ejecutá (**Run**).

### Si el índice HNSW falla

Tu imagen de Postgres/pgvector podría no soportar HNSW. En ese caso seguí el comentario de la migración: deshabilitá el `CREATE INDEX` HNSW y usá **IVFFlat** con `lists` acorde al volumen; después **`ANALYZE public.document_chunks`**.

### Verificación rápida

```sql
select extname, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where extname = 'vector';

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'document_chunks'
order by policyname;

select proname, prosecdef as security_definer
from pg_proc
where proname = 'match_document_chunks';
```

Esperado: extensión `vector` (típicamente esquema `extensions`), política **`document_chunks_select_member`** solo para **`SELECT` / `authenticated`**, y la función marcada como **SECURITY DEFINER**.

## 2. Variables en Render (API Flask)

| Variable | Descripción |
|----------|-------------|
| `GEMINI_API_KEY` | Clave de Google AI para embeddings (`gemini-embedding-001`, salida **1536**). **Solo servidor**; nunca en `NEXT_PUBLIC_*`. |

Siguen siendo obligatorias las variables de fases previas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_AUDIENCE`, `WEB_ORIGIN`, etc.

## 3. Timeouts e indexación S1 (riesgo operativo)

- La indexación en línea puede alargar el tiempo de respuesta del **POST** `/v1/tenants/{tenant}/documents` y disparar **timeouts** en proxies (Render/Vercel) o en el cliente si el Markdown es grande o la API de embeddings está lenta.
- Mitigación inmediata: **`MAX_UPLOAD_BYTES`** acotado, documentos de prueba pequeños, y revisar logs del servicio Flask.
- Evolución probable: cola asíncrona / worker (fuera de alcance de esta fase).

## 4. Probar recuperación semántica (RPC vía Flask)

La RPC **`match_document_chunks`** no está expuesta a `authenticated` por diseño: **solo** debe invocarse con **`service_role`** desde Flask.

Endpoint de prueba (requiere JWT de usuario miembro del tenant y cabecera **`X-Tenant-Id`**):

`POST /v1/tenants/{tenant_id}/rag/query`

Cuerpo JSON mínimo:

```json
{
  "query": "texto de búsqueda en lenguaje natural",
  "match_count": 8,
  "min_similarity": 0.25
}
```

Respuesta: `{ "matches": [ ... ] }` con columnas devueltas por la RPC (`chunk_id`, `document_id`, `heading_path`, `body`, `similarity`).

### Prueba directa en SQL Editor (opcional, solo service_role)

No aplica desde el rol `authenticated` del Dashboard por los `REVOKE`; usá el flujo Flask anterior o un script interno con **`service_role`**.

## 5. Reindexación manual

`POST /v1/tenants/{tenant_id}/documents/{document_id}/reindex` — roles **`editor`**, **`admin`** u **`owner`**. Útil cuando `index_status = failed` y se corrigió el origen (p. ej. UTF-8 o tamaño).

## 6. Definition of Done (manual)

- [ ] Migración aplicada sin errores y extensión `vector` visible.
- [ ] `GEMINI_API_KEY` configurada en Render; reinicio del servicio OK.
- [ ] Subida de `.md` pequeño: documento pasa a **`ready`** y existen filas en `public.document_chunks` coherentes con el contenido.
- [ ] Subida de `.html`: documento en **`ready`** sin chunks (no queda colgado en **`pending`**).
- [ ] `rag/query` devuelve coincidencias razonables para una consulta de prueba.
- [ ] `viewer` no puede **reindexar** ni **subir**; **`editor+`** sí.
