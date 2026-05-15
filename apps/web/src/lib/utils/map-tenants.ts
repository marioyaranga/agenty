import type { TenantOption } from "@/lib/types/tenant";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export function mapTenants(rows: MembershipRow[]): TenantOption[] {
  return rows.map((row) => {
    const t = row.tenants;
    const tenant = Array.isArray(t) ? t[0] : t;
    return {
      tenantId: row.tenant_id,
      role: row.role,
      name: tenant?.name?.trim() ? tenant.name : "Espacio sin nombre",
    };
  });
}
