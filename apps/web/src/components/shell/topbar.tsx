"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useWorkspace } from "@/lib/contexts/workspace-context";

type TopBarProps = {
  userEmail: string;
};

export function TopBar({ userEmail }: TopBarProps) {
  const { tenants, activeTenantId, setActiveTenantId } = useWorkspace();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-sm font-semibold text-foreground">workyAI</span>

      <div className="ml-auto flex items-center gap-3">
        {tenants.length > 0 && activeTenantId ? (
          <select
            value={activeTenantId}
            onChange={(e) => setActiveTenantId(e.target.value)}
            className="h-7 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}

        <span className="hidden text-xs text-muted-foreground sm:block">
          {userEmail}
        </span>
      </div>
    </header>
  );
}
