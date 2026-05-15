# Fase 6 — Clave Gemini por tenant (Fernet + fallback)

## Objetivo

Permitir que cada tenant use su propia **Google Gemini API key** para embeddings (RAG) y para el chat del agente, almacenada **cifrada en reposo** en Postgres. Si no hay clave por tenant, el backend usa la variable global **`GEMINI_API_KEY`**. Además, cada tenant puede elegir el **modelo de chat del agente** (reescritura + generación RAG) entre una lista permitida en Flask; ver columna `agent_chat_model` y migración `20260514240000_phase9_agent_chat_model.sql`.

## Base de datos

- Migraciones: `supabase/migrations/20260514160000_phase6_tenant_gemini_settings.sql` y `20260514240000_phase9_agent_chat_model.sql` (columna `agent_chat_model`).
- Tabla: `public.tenant_ai_settings` (`tenant_id` PK, `gemini_api_key_encrypted`, `agent_chat_model` opcional, `updated_at`, `updated_by`).
- **RLS** activado **sin** políticas para `authenticated`; **sin** `GRANT` a `anon`/`authenticated`. Solo el cliente **service_role** (Flask en Render) lee y escribe esta tabla.

Aplicar la migración con Supabase CLI o SQL Editor antes de usar los endpoints de configuración.

## Backend (Flask)

- **`TENANT_SECRETS_FERNET_KEY`**: clave Fernet en base64 (generar con `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`). Debe ser la misma en todos los procesos que cifran o descifran.
- **`GEMINI_API_KEY`**: sigue siendo necesaria como mínimo global si ningún tenant tiene clave propia (o como respaldo cuando no hay fila cifrada).
- Endpoints: ver `apps/api/README.md` (`GET`/`PATCH`/`PUT`/`DELETE` `/v1/tenants/<tenant_id>/settings/ai`). `DELETE` solo borra la clave cifrada y conserva `agent_chat_model`.

## Frontend

- Pantalla: `apps/web/src/app/(app)/settings/page.tsx` (JWT + `X-Tenant-Id` al API).
- **Owner** y **admin** pueden guardar o quitar la clave y el modelo de chat; **editor** y **viewer** ven estado y modelo en uso (solo lectura para cambios).

## Verificación rápida

1. Aplicar migración en Supabase.
2. Definir `TENANT_SECRETS_FERNET_KEY` y `GEMINI_API_KEY` en Render (Flask).
3. `PUT /settings/ai` con una clave válida; comprobar indexación de un Markdown y una pregunta en el chat.
4. `DELETE /settings/ai` y comprobar que sigue funcionando el RAG con la clave global y que el modelo elegido se conserva.
5. `PATCH /settings/ai` con `{"agent_chat_model":"gemini-3.1-flash-lite"}` (u otro ID de la lista) y comprobar el chat.

## Seguridad

- No commitear claves reales ni la Fernet de producción en el repositorio.
- Rotación: generar nueva `TENANT_SECRETS_FERNET_KEY`, **re-cifrar** todas las filas (script operativo fuera de alcance de esta fase) o pedir a cada tenant que vuelva a guardar la clave tras el cambio.
