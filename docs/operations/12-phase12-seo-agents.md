# Fase 12 — Agentes SEO (DataForSEO por tenant)

## Objetivo

Flujo **SEO separado** del chat documental (RAG/CRUD): orquestador que delega en subagentes de **volumen de búsqueda** y **SERP** vía DataForSEO, con credenciales y defaults por espacio (tenant).

## Base de datos

- Migración: `supabase/migrations/20260516120000_phase12_tenant_seo_settings.sql`
- Tabla: `public.tenant_seo_settings`
  - `dataforseo_login_encrypted`, `dataforseo_password_encrypted` (Fernet en Flask)
  - `seo_location_code` (default **2484** = México)
  - `seo_language_code` (default **es**)
  - `seo_serp_mode` (fijo **advanced** en v1)
  - `seo_serp_depth` (default **10**, CHECK 5–30)
- **RLS** activado, sin políticas para `authenticated`; solo `service_role` (Flask).

Aplicar la migración antes de usar los endpoints.

## Backend (Flask)

- `TENANT_SECRETS_FERNET_KEY`: obligatoria para **PUT** `/settings/seo`.
- **Sin fallback global** de DataForSEO: cada tenant debe guardar credenciales propias.
- Gemini: sigue usando `tenant_ai_settings` / `GEMINI_API_KEY` solo para parsear el mensaje libre (modo + keywords).
- Volumen: endpoint **Google Ads Search Volume live** (`/v3/keywords_data/google_ads/search_volume/live`); el parser lee cada keyword en `tasks[].result[]` (no en `result[].items[]`, que es el formato clickstream).
- Guardrails v1:
  - Volumen: máx. **50** keywords por mensaje
  - SERP: máx. **10** keywords por mensaje
  - `seo_serp_depth`: 5–30 (default 10)
  - Síncrono, sin caché
- `agent_steps`: se usan `retrieve` y `generate` con payload `seo: true` (sin ampliar CHECK).

### Endpoints

| Método | Ruta | Rol |
|--------|------|-----|
| GET | `/v1/tenants/<id>/settings/seo` | cualquier miembro |
| PUT | `/v1/tenants/<id>/settings/seo` | owner/admin |
| DELETE | `/v1/tenants/<id>/settings/seo` | owner/admin (solo credenciales) |
| POST | `/v1/tenants/<id>/agent/seo/chat` | editor+ |

Body chat: `{ "message": "...", "thread_id": null | uuid }`.

Respuesta: `run_id`, `thread_id`, `answer`, `citations: []`, **`steps`** (subagentes para la UI), LangSmith opcional.

Cada run persiste pasos en `agent_steps` con `payload.seo: true` y `payload.phase` en `parse` | `volume` | `serp` | `format` (mismos `step_key` `retrieve` / `generate` que el chat documental).

## Frontend

- Ajustes: sección DataForSEO en `settings-page-client.tsx`
- Chat SEO: `/seo` → `SeoPageClient` + `SeoThread` + panel acordeón de subagentes (`seo-subagents-panel.tsx`, `seo-steps-context.tsx`)
- Enlaces: Panel, Documentos, Ajustes → `/seo`

## Verificación manual

1. Aplicar migración en Supabase.
2. Owner/admin: **PUT** `/settings/seo` con login/password válidos y `location_code` / `language_code` / `serp_depth`.
3. Editor+: mensajes de prueba:
   - «dame volumen de marketing digital y agencia seo»
   - «SERP de keyword X»
   - «volumen + serp de …»
4. Confirmar que `answer` incluye **Configuración usada** con `location_code`, `language_code`, `SERP=advanced`, `depth`.

## Seguridad

- No commitear credenciales DataForSEO ni Fernet de producción.
- Las credenciales nunca salen del servidor descifradas al cliente.
