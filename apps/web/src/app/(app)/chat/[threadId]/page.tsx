import { ChatPageClient } from "@/components/chat-page-client";
import { createClient } from "@/lib/supabase/server";
import type { TenantOption } from "@/lib/types/tenant";

export const dynamic = "force-dynamic";

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenants: { id: string; name: string } | { id: string; name: string }[] | null;
};

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const supabase = await createClient();

  const { data: rows } = await supabase
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

  return <ChatPageClient tenants={tenants} initialThreadId={threadId} />;
}
