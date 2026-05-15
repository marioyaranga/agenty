"use client";

import { Button } from "@/components/ui/button";

import type { TenantOption } from "@/lib/types/tenant";

type TenantSwitcherProps = {
  tenants: TenantOption[];
  activeTenantId: string;
  onSelect: (tenantId: string) => void;
};

export function TenantSwitcher({
  tenants,
  activeTenantId,
  onSelect,
}: TenantSwitcherProps) {
  if (tenants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay espacios visibles para tu usuario. Cerrá sesión y volvé a entrar. Si la migración
        multi-tenant se aplicó después de crear tu cuenta, puede faltar una membresía: revisá el
        backfill en la documentación de la fase 2.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">Espacio activo</p>
      <div className="flex flex-wrap gap-2">
        {tenants.map((t) => (
          <Button
            key={t.tenantId}
            type="button"
            size="sm"
            variant={t.tenantId === activeTenantId ? "default" : "outline"}
            onClick={() => onSelect(t.tenantId)}
          >
            {t.name}
            <span className="ml-1 text-xs opacity-80">({t.role})</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
