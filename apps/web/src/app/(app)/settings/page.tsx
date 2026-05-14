import Link from "next/link";

import { SettingsPageClient } from "@/components/settings-page-client";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";
import type { TenantOption } from "@/lib/types/tenant";

export const dynamic = "force-dynamic";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export default async function SettingsPage() {
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
            <p className="text-sm text-muted-foreground">workyAI · Configuración</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              IA del espacio
            </h1>
            <p className="text-sm text-muted-foreground">
              Sesión:{" "}
              <span className="font-medium text-foreground">{user?.email}</span>
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
                href="/audit"
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Auditoría
              </Link>
            ) : null}
          </div>
        </header>

        {membershipError ? (
          <p className="text-sm text-destructive" role="alert">
            No se pudieron cargar los espacios: {membershipError.message}
          </p>
        ) : null}

        <SettingsPageClient tenants={tenants} />
      </main>
    </div>
  );
}
