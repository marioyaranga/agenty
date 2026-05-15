import Link from "next/link";

import { DashboardClientShell } from "@/components/dashboard-client-shell";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";
import type { TenantOption } from "@/lib/types/tenant";

export const dynamic = "force-dynamic";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export default async function DashboardPage() {
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
            <p className="text-sm text-muted-foreground">workyAI · Fase 2</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Panel
            </h1>
            <p className="text-sm text-muted-foreground">
              Sesión iniciada como{" "}
              <span className="font-medium text-foreground">{user?.email}</span>
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              id: {user?.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LogoutButton />
            <Link
              href="/chat"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Chat
            </Link>
            <Link
              href="/seo"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              SEO
            </Link>
            <Link
              href="/documents"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Documentos
            </Link>
            <Link
              href="/settings"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Configuración
            </Link>
            {showAuditNav ? (
              <Link
                href="/audit"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Auditoría
              </Link>
            ) : null}
            <Link
              href="/"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Inicio
            </Link>
          </div>
        </header>

        {membershipError ? (
          <p className="text-sm text-destructive" role="alert">
            No se pudieron cargar los espacios: {membershipError.message}
          </p>
        ) : null}

        <DashboardClientShell tenants={tenants} />
      </main>
    </div>
  );
}
