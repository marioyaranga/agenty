import Link from "next/link";

import { AuditPageClient } from "@/components/audit-page-client";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";
import type { TenantOption } from "@/lib/types/tenant";

export const dynamic = "force-dynamic";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export default async function AuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants (id, name)")
    .returns<MembershipRow[]>();

  const tenants: TenantOption[] = (rows ?? []).map((row) => {
    const t = row.tenants;
    const tenant = Array.isArray(t) ? t[0] : t;
    return {
      tenantId: row.tenant_id,
      role: row.role,
      name: tenant?.name?.trim() ? tenant.name : "Espacio sin nombre",
    };
  });

  const showAuditNav = tenants.some(
    (t) => t.role === "owner" || t.role === "admin",
  );

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">workyAI · Auditoría</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Registro de eventos
            </h1>
            <p className="text-sm text-muted-foreground">
              Sesión:{" "}
              <span className="font-medium text-foreground">{user?.email}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Eventos append-only correlacionados al tenant (vía API Flask). La
              lectura en Postgres usa RLS para roles owner/admin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LogoutButton />
            <Link
              href="/dashboard"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Panel
            </Link>
            {showAuditNav ? (
              <Link
                href="/settings"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Configuración
              </Link>
            ) : null}
          </div>
        </header>

        {membershipError ? (
          <p className="text-sm text-destructive" role="alert">
            No se pudieron cargar los espacios: {membershipError.message}
          </p>
        ) : null}

        <AuditPageClient tenants={tenants} />
      </main>
    </div>
  );
}
