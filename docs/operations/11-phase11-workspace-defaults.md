# Fase 11 — Seeding de contenido por defecto en workspaces

## Resumen

Cuando un usuario accede a su workspace por primera vez (o cuando el workspace existía
pero estaba vacío antes de este deploy), la app siembra automáticamente:

- Carpeta **`Bienvenida/`** en la raíz del explorador
- Documento **`README.md`** (Markdown) dentro de esa carpeta, con texto de bienvenida
- Documento **`guia.html`** (HTML) dentro de esa carpeta, como demo de tipo de archivo

El seeding es **idempotente**: la bandera `tenants.defaults_seeded_at` garantiza que
sucede exactamente una vez por workspace, incluso ante requests concurrentes.

## Migración

**Archivo:** `supabase/migrations/20260516000000_phase11_workspace_defaults.sql`

Añade la columna `defaults_seeded_at timestamptz NULL` a `public.tenants`.

**Cómo aplicar en Supabase:**
1. SQL Editor → New query → pegar el archivo → Run.
2. Verificar:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tenants'
     AND column_name='defaults_seeded_at';
   ```

No se requieren políticas RLS adicionales: la columna la escribe solo el endpoint
Flask con `service_role` (usa `admin_supabase_client()`). Los clientes autenticados
no tienen `INSERT` genérico sobre `tenants`.

## Endpoint

`POST /v1/tenants/<tenant_id>/bootstrap-defaults`

- Requiere JWT válido + header `X-Tenant-Id` coincidente + rol `editor`, `admin` u `owner`.
- Intenta `UPDATE tenants SET defaults_seeded_at = now() WHERE id = :tid AND defaults_seeded_at IS NULL RETURNING id`.
  Si no devuelve filas → `200 { "status": "already_seeded" }`.
  Si devuelve fila → crea carpeta + 2 documentos (vía `tool_create_folder` / `tool_create_document` de `agent/tools.py`).
- Ante fallo en cualquier paso: revierte `defaults_seeded_at` a `NULL` y devuelve `502`.
- Éxito: `201 { "status": "seeded", "folder_id": "...", "documents": [...] }`.
- Auditoría: emite `workspace.defaults_seeded` en `audit_events`.

**Archivo:** `apps/api/routes/workspace_bootstrap.py`
**Registrado en:** `apps/api/app.py`

## Flujo front-end

`workspace-context.tsx` dispara el endpoint como fire-and-forget la primera vez que
`activeTenantId` se establece en la sesión actual (guarda un `useRef<Set<string>>`
de los tenants ya intentados para no repetir en re-renders). Si la respuesta es
`status: "seeded"`, incrementa `bootstrapTick` en el contexto. El explorador
(`file-explorer-panel.tsx`) incluye `bootstrapTick` en las dependencias de `loadTree`,
así re-fetcha el árbol automáticamente cuando hay contenido nuevo.

## RLS

Sin cambios de RLS en esta fase. La columna `defaults_seeded_at` solo la escribe
Flask con `service_role`. Los documentos y carpetas creados por el seeding usan las
mismas políticas que ya existían (fase 10): INSERT permitido a `editor`, `admin`, `owner`
del tenant.

## Deuda técnica

`docs/operations/10-phase10-folders-and-agent-tools.md` está referenciado en la
migración `20260515000000_phase10_document_folders.sql:7` pero no existe en el repo.
Crearlo con la descripción del modelo de árbol (`document_folders` + `documents.folder_id`),
las políticas RLS y los pasos de verificación de la fase 10.

## Verificación

1. Aplicar migración en Supabase (ver arriba).
2. `git push origin main` → esperar deploy en Render (API) y Vercel (web).
3. Loguearse en https://agenty-delta.vercel.app/ con el tenant existente (vacío):
   - Network → `POST /v1/tenants/.../bootstrap-defaults` → `201 seeded`.
   - Explorador muestra `Bienvenida/README.md` y `Bienvenida/guia.html`.
   - Segunda recarga → `200 already_seeded` (sin duplicados).
4. Con un email de prueba nuevo:
   - Signup → entrar a la app → mismo flujo automático.
   - `SELECT title, index_status FROM documents WHERE tenant_id='...';` → 2 filas.
   - `SELECT name FROM document_folders WHERE tenant_id='...';` → "Bienvenida".
5. Auditoría: `SELECT event_type FROM audit_events WHERE tenant_id='...' ORDER BY created_at DESC LIMIT 5;`
   debe incluir `workspace.defaults_seeded`.
