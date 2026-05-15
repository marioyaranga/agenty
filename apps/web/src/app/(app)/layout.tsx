import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { InAppNotificationsHost } from "@/components/in-app-notifications-host";
import { createClient } from "@/lib/supabase/server";
import { mapTenants } from "@/lib/utils/map-tenants";

export const dynamic = "force-dynamic";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export default async function AppGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  const { data: rows } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants (id, name)")
    .returns<MembershipRow[]>();

  const tenants = mapTenants(rows ?? []);
  const showAudit = tenants.some(
    (t) => t.role === "owner" || t.role === "admin",
  );

  return (
    <>
      <InAppNotificationsHost userId={data.user.id} />
      <AppShell
        tenants={tenants}
        userEmail={data.user.email ?? ""}
        showAudit={showAudit}
      >
        {children}
      </AppShell>
    </>
  );
}
