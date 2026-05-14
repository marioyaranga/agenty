# workyAI

Monorepo mínimo: **Next.js** (`apps/web`, Vercel) y **Flask** (`apps/api`, Render), alineado al contrato de arquitectura y al despliegue en fase 1.

## Documentación

- Contrato del sistema (Fase 0): [docs/architecture/00-system-contract.md](docs/architecture/00-system-contract.md)
- Checklist de despliegue Fase 1 (Supabase, Render, Vercel): [docs/operations/01-phase1-deploy.md](docs/operations/01-phase1-deploy.md)
- Fase 2 (Auth Supabase SSR, tenants, JWT en Flask): [docs/operations/02-phase2-auth-tenant.md](docs/operations/02-phase2-auth-tenant.md)
- Fase 3 (Documentos, Storage privado, API Flask): [docs/operations/03-phase3-documents-storage.md](docs/operations/03-phase3-documents-storage.md)

## Estructura

| Ruta | Descripción |
|------|-------------|
| `apps/web/` | Frontend Next.js (App Router, TypeScript) |
| `apps/api/` | API Flask + Gunicorn |
| `supabase/migrations/` | SQL versionado para Postgres/RLS |

Cada app incluye su propio `README.md` con variables y comandos.
