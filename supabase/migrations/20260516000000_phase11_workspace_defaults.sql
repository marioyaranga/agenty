-- Fase 11: bandera de seeding por defecto por workspace.
--
-- Añade `defaults_seeded_at` a `public.tenants` para marcar que ya se creó
-- la carpeta y archivos iniciales (Bienvenida/README.md + guia.html).
-- La columna la escribe solo el endpoint Flask con service_role; no requiere
-- políticas RLS adicionales sobre la columna porque los clientes autenticados
-- no tienen INSERT genérico sobre `tenants` (solo SELECT y UPDATE con gate de rol).
--
-- Cómo aplicar: docs/operations/11-phase11-workspace-defaults.md

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS defaults_seeded_at timestamptz NULL;

COMMENT ON COLUMN public.tenants.defaults_seeded_at IS
  'Timestamp del seeding por defecto (Bienvenida/README.md + guia.html). NULL = aún no sembrado.';
