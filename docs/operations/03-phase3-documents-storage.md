# Fase 3 — Documentos (Postgres + Storage) y `index_status`

Esta fase añade la tabla `public.documents`, el bucket privado `tenant_documents` y endpoints Flask para subir, descargar y borrar archivos de texto/markdown/html por tenant, con comprobación de JWT y rol (`viewer` solo lectura; `editor` / `admin` / `owner` pueden mutar).

## 1. Aplicar la migración SQL

1. En **Supabase Dashboard** → **SQL Editor** → nueva consulta.
2. Pegá el contenido completo de  
   `supabase/migrations/20260514130000_phase3_documents.sql`
3. Ejecutá (**Run**).

### Verificación rápida

```sql
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'documents'
order by policyname;

select id, name, public from storage.buckets where id = 'tenant_documents';
```

Esperado: políticas `documents_*` para `SELECT` / `INSERT` / `UPDATE` / `DELETE` sobre `authenticated`, y una fila en `storage.buckets` con `public = false`.

## 2. Bucket y políticas Storage

- La migración intenta crear el bucket **`tenant_documents`** como **privado** (`public = false`) mediante `INSERT` en `storage.buckets` (alineado con la [documentación de buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets)).
- En Fase 3 el **I/O de objetos** lo hace **Flask con `service_role`**, que **omite RLS** de Storage. No es obligatorio definir políticas en `storage.objects` para este flujo.
- Si el `INSERT` en `storage.buckets` fallara por permisos o por un entorno restringido, creá el bucket **a mano** en **Storage → New bucket**:
  - Nombre: `tenant_documents`
  - **Private** (no público)
- Si más adelante se habilita lectura/escritura directa desde el navegador, habrá que **endurecer políticas** en `storage.objects` y revisar el modelo de confianza.

## 3. Variables en Render (API Flask)

En el servicio **Web** de `apps/api`:

| Variable | Descripción |
|----------|-------------|
| `MAX_UPLOAD_BYTES` | Tamaño máximo del archivo (bytes). Por defecto en código: `5242880` (5 MiB). Debe ser coherente con el tier de Storage y con `MAX_CONTENT_LENGTH` (se añade margen para multipart). |

Las variables ya usadas en Fase 2 siguen siendo necesarias: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_ORIGIN`, etc.

## 4. Variables en Vercel (Next)

- `NEXT_PUBLIC_API_URL` — URL base del API Flask (sin barra final recomendada).
- Variables Supabase del front sin cambios respecto a Fase 2.

## 5. Seguridad post-despliegue

1. **Dashboard** → **Advisors** (Security) y revisar hallazgos tras la migración.
2. Probar manualmente:
   - Usuario **`viewer`**: listado y descarga OK; **POST** y **DELETE** deben responder **403**.
   - Usuario **`editor`** (o superior): subida multipart (`title` + `file`), fila visible en listado, descarga y borrado.

## 6. Convención de rutas en Storage

Clave dentro del bucket:

`{tenant_id}/{document_id}/{nombre_seguro}`

Coincide con la columna `storage_path` en `public.documents`.

## 7. `index_status`

- `pending`: pendiente de indexación RAG (Fase 4: típicamente **Markdown** `text/markdown` / `text/x-markdown` creado vía API Flask).
- `ready`: listo o sin indexación requerida (p. ej. **HTML** y otros tipos sin pipeline pgvector en v1).
- `failed`: error de indexación; revisar `index_error` (Fase 4+).
