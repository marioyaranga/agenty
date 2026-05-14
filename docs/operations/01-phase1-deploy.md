# Fase 1 — Despliegue cloud (Supabase + Render + Vercel)

Runbook para aprovisionar la **única** línea productiva alineada a [docs/architecture/00-system-contract.md](../architecture/00-system-contract.md): usuario → Next (Vercel) → Supabase Auth; Next → Flask (Render) con JWT en fases posteriores. En Fase 1 solo se validan URLs, variables y conectividad (`/health`).

---

## Matiz “cloud-only”

**Cloud-only** significa que no dependemos de **Supabase local** (Docker) para esta fase; sigue haciendo falta **Git push** desde tu entorno o desde la UI de GitHub. Si no ejecutás Next/Flask en tu PC, el flujo típico es editar en el remoto y dejar que Vercel/Render construyan.

---

## Cold start (Render, plan gratuito)

El **primer request** tras un periodo de inactividad puede tardar **decenas de segundos** mientras el servicio despierta. Para pruebas: esperá, repetí el `curl` o recargá la home de Vercel; revisá logs en Render si supera ~1–2 minutos.

---

## 1. Supabase (dashboard)

1. Crear **un** proyecto (región acordada con el equipo).
2. **Settings → API**
   - Anotar **Project URL** (`SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` en cada capa según corresponda).
   - Anotar **anon / public** (`NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel).
   - Anotar **service_role** solo para backend (Render → variable server-side; **nunca** en `NEXT_PUBLIC_*`).
3. **Authentication → URL configuration**
   - **Site URL:** `https://<tu-proyecto>.vercel.app` (o dominio custom cuando exista).
   - **Redirect URLs:** incluir al menos:
     - `https://<tu-proyecto>.vercel.app`
     - `https://<tu-proyecto>.vercel.app/**`  
     (Ajustar según la guía actual de Supabase si el dashboard exige comodines distintos.)
4. (Opcional Fase 1) **Authentication → Providers:** dejar email/OAuth según roadmap de Fase 2; documentar “pendiente” si no se prueba login aún.
5. Verificación rápida: abrir el SQL Editor y ejecutar `select 1` solo para confirmar proyecto activo (sin tablas de dominio aún).

---

## 2. Render (Flask, `apps/api`)

1. **New → Web Service** (o desplegar desde `render.yaml` en la raíz del repo).
2. Conectar el **mismo repositorio** que Vercel.
3. **Root Directory:** `apps/api`.
4. **Build command:** `pip install -r requirements.txt`
5. **Start command:** `gunicorn app:app --bind 0.0.0.0:$PORT`
6. **Health check path:** `/health`
7. **Plan:** Free (según acuerdo; revisar límites de cold start).
8. **Environment variables** (mínimo Fase 1 + reservadas Fase 2):

| Key | Dónde va | Notas |
|-----|------------|--------|
| `WEB_ORIGIN` | Render | URL de Vercel, p. ej. `https://<proyecto>.vercel.app`. Sin esto el navegador puede bloquear CORS al llamar al API. |
| `SUPABASE_URL` | Render | Placeholder hasta Fase 2 si aún no se usa en código. |
| `SUPABASE_SERVICE_ROLE_KEY` | Render | Secreto; solo servidor. |
| `LANGSMITH_API_KEY` | Render | Opcional / vacío hasta fases de observabilidad. |

9. Tras el deploy: `curl https://<servicio>.onrender.com/health` → `200` y cuerpo `{"status":"ok"}`.

---

## 3. Vercel (Next.js, `apps/web`)

1. **Add New → Project** e importar el repositorio del monorepo.
2. **Root Directory:** `apps/web` (Framework Preset: Next.js).
3. **Environment Variables** (Production / Preview según política):

| Key | Valor típico |
|-----|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon/public. |
| `NEXT_PUBLIC_API_URL` | URL base del API Render **sin** path (p. ej. `https://xxx.onrender.com`). |

4. Desplegar y abrir la URL de producción: la home debe mostrar si cada `NEXT_PUBLIC_*` está definida y el resultado del fetch a `/health` si CORS y URL son correctos.
5. Volver a Supabase y **confirmar** que Site URL y Redirect URLs coinciden con la URL real de Vercel tras el primer deploy.

---

## 4. Verificación final (checklist)

| Paso | Criterio |
|------|-----------|
| Supabase | Dashboard accesible; URL y keys copiadas en tabla interna (sin pegar `service_role` en Vercel). |
| Render | Logs sin crash loop; `/health` responde `200`. |
| Vercel | Build verde; home carga; estado del API “ok” si `NEXT_PUBLIC_API_URL` y `WEB_ORIGIN` están bien. |
| Secretos | Ningún `service_role` ni API keys privadas en variables `NEXT_PUBLIC_*`. |

---

## 5. Tabla de secretos (rellenar con valores reales)

> Guardar esta tabla en el gestor de secretos del equipo (1Password, Vault, etc.), no en el repo.

| Secreto / variable | Entorno | Valor (placeholder) |
|--------------------|---------|------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | `https://___.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | `<anon>` |
| `NEXT_PUBLIC_API_URL` | Vercel | `https://___.onrender.com` |
| `WEB_ORIGIN` | Render | `https://___.vercel.app` |
| `SUPABASE_URL` | Render | `https://___.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Render | `<service_role>` |
| `LANGSMITH_API_KEY` | Render | _(opcional)_ |

---

## Referencias cruzadas

- Contrato técnico: [00-system-contract.md](../architecture/00-system-contract.md)
- README raíz del monorepo: [README.md](../../README.md)
