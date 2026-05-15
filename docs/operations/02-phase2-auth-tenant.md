# Fase 2 — Autenticación Supabase, multi-tenant y JWT hacia Flask

Este runbook asume la Fase 1 desplegada ([01-phase1-deploy.md](./01-phase1-deploy.md)): Vercel con `apps/web`, Render con `apps/api`, proyecto Supabase creado.

## 1. Orden de aplicación de la migración SQL

1. En el repo, el SQL versionado está en `supabase/migrations/20260514120000_phase2_tenants_memberships.sql`.
2. **Producción (recomendado para equipos sin CLI enlazada):** Supabase Dashboard → **SQL Editor** → nueva consulta → pegar el contenido completo del archivo → **Run**.
3. **Alternativa (CLI enlazada al proyecto remoto):** `supabase db push` o `supabase migration up` según tu flujo; no ejecutes SQL intermedio con `execute_sql` en remoto si querés historial limpio en `schema_migrations`.
4. Tras aplicar: **Database → Tables** deberías ver `public.tenants` y `public.tenant_memberships` con RLS activo.

## 2. Auth URL y proveedor de email (Supabase Dashboard)

En **Authentication → URL configuration**:

- **Site URL:** la URL canónica del front (p. ej. `https://tu-proyecto.vercel.app`).
- **Redirect URLs:** incluir `https://tu-proyecto.vercel.app/**` y `http://localhost:3000/**` para desarrollo.

En **Authentication → Providers:** habilitar **Email** (contraseña o magic link según preferencia). Esta fase usa **email + contraseña** en `apps/web`.

**Límites del plan gratuito:** el envío de correos de confirmación/recuperación está sujeto a cuotas del proveedor de Auth de Supabase. Si superás el límite, los correos pueden demorarse o fallar; revisá el panel de Auth y los logs. Para producción seria, configurá SMTP propio o un proveedor de email acorde.

## 3. Variables de entorno

### Vercel (`apps/web`)

Sin cambios respecto a la Fase 1 en lo esencial:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave anon legada) **o** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (clave publishable nueva).
- `NEXT_PUBLIC_API_URL` (URL del servicio Flask en Render).

No añadas `service_role` ni secretos con prefijo `NEXT_PUBLIC_`.

### Render (`apps/api`)

| Variable | Uso |
|----------|-----|
| `WEB_ORIGIN` | CORS: origen(s) del front, separados por coma. |
| `SUPABASE_URL` | JWKS + `iss` del JWT (`{SUPABASE_URL}/auth/v1`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: consulta `tenant_memberships` cuando el cliente envía `X-Tenant-Id`. |
| `JWT_AUDIENCE` | Opcional; por defecto `authenticated` (claim `aud` típico del usuario Supabase). |

## 4. Comportamiento de tokens y refresh

- El **access token** (JWT) se renueva con el **refresh token** guardado en cookies por `@supabase/ssr` y el `middleware` de Next.js (`getClaims()` refresca la sesión).
- Si el access token **expira** durante una llamada al API Flask, la petición puede responder **401** hasta que el front refresque la sesión (navegación o nueva llamada tras el middleware).
- **Importante:** revocar sesión o borrar usuario no invalida instantáneamente todos los JWT ya emitidos hasta `exp`; para operaciones muy sensibles considerá TTL cortos o validación adicional en servidor.

## 5. Verificación de RLS y asesores de seguridad

1. **RLS:** con un usuario de prueba, en SQL Editor podés inspeccionar políticas (`pg_policies`) y probar lecturas como rol `authenticated` (desde la app es más simple: dashboard lista membresías).
2. **Dashboard → Advisors (Security):** ejecutar tras la migración y corregir hallazgos (p. ej. vistas sin `security_invoker`, funciones `mutable search_path`, etc.).
3. **UPDATE + SELECT:** las políticas de `tenants` incluyen `SELECT` para miembros y `UPDATE` acotado a `owner`/`admin`, alineado a la nota de Supabase/Postgres (UPDATE requiere poder “ver” la fila).

## 6. Contrato `GET /v1/me` (Flask)

- **Authorization:** `Bearer <access_token>` (JWT de usuario, no service_role).
- **X-Tenant-Id (opcional):** UUID del tenant; el API comprueba membresía con `service_role` y responde **403** si no hay fila `(user_id, tenant_id)`.
- No se registra el contenido del header `Authorization` en logs de aplicación.

## 7. Checklist E2E sugerido

1. Registro o login en `/login`.
2. `/dashboard` muestra email, id y espacios del usuario (datos vía RLS).
3. Selector de espacio + botón **GET /v1/me** devuelve JSON 200 con `tenant_id` y `role` cuando el tenant es válido; con otro UUID debería responder **403**.

## 8. Respaldo

Antes de migraciones en producción, usá **Backups** del proyecto Supabase (plan permitido) o `pg_dump` según política interna.

## 9. Diagnóstico: `Could not find the table 'public.tenant_memberships' in the schema cache`

Ese mensaje lo devuelve el cliente de Supabase (PostgREST) cuando **la tabla no existe** en el proyecto al que apuntan `NEXT_PUBLIC_SUPABASE_URL` y la clave pública: la migración de esta fase **no se aplicó** en ese proyecto remoto, o el front está enlazado a **otro** proyecto Supabase distinto del que migraste.

**Qué hacer:** aplicá el SQL de `supabase/migrations/20260514120000_phase2_tenants_memberships.sql` en el **mismo** proyecto que usan las variables de Vercel (Dashboard → SQL Editor → Run, o `supabase db push` con el proyecto correcto). Verificá en **Table Editor** que existan `public.tenants` y `public.tenant_memberships`. Luego **cerrá sesión** en la app y volvé a entrar para refrescar la sesión y la caché del cliente.

No suele ser un error de nombre en el código del repo: el nombre `tenant_memberships` es el canónico de la fase 2.
