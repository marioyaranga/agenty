# workyAI · Web (Next.js)

App Router, TypeScript y `src/`. UI base con **shadcn/ui** (variables CSS, tema oscuro activo en `layout`).

## Variables de entorno

Definí estos valores en Vercel (y opcionalmente en `.env.local` para desarrollo). **No** pongas `service_role` ni otros secretos en `NEXT_PUBLIC_*`.

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase (p. ej. `https://xxxx.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave **anon / publishable** para el cliente. |
| `NEXT_PUBLIC_API_URL` | URL base del API en Render **sin** barra final obligatoria (p. ej. `https://workyai-api.onrender.com`). La home llama a `{NEXT_PUBLIC_API_URL}/health`; el panel usa `{NEXT_PUBLIC_API_URL}/v1/me`. |

Copiá `.env.example` a `.env.local` y rellená valores de prueba.

Fase 2 (Auth, tenants, JWT): [docs/operations/02-phase2-auth-tenant.md](../../docs/operations/02-phase2-auth-tenant.md).

## Scripts

```bash
npm install
npm run dev
npm run build
```

## Despliegue (Vercel)

Importá el monorepo y establecé el directorio raíz del proyecto en **`apps/web`**. Sincronizá las variables de entorno anteriores.

Pasos detallados: [docs/operations/01-phase1-deploy.md](../../docs/operations/01-phase1-deploy.md).
