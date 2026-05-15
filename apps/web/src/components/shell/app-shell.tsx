"use client";

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/lib/contexts/workspace-context";
import { SidebarLeft } from "@/components/shell/sidebar-left";
import { TopBar } from "@/components/shell/topbar";
import type { TenantOption } from "@/lib/types/tenant";

type AppShellProps = {
  children: React.ReactNode;
  tenants: TenantOption[];
  userEmail: string;
  showAudit: boolean;
};

export function AppShell({
  children,
  tenants,
  userEmail,
  showAudit,
}: AppShellProps) {
  return (
    <TooltipProvider>
      <WorkspaceProvider tenants={tenants}>
        <SidebarProvider className="h-full min-h-0">
          <SidebarLeft showAudit={showAudit} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TopBar userEmail={userEmail} />
            <ResizablePanelGroup className="flex-1 overflow-hidden">
              <ResizablePanel id="center" minSize={40}>
                <ScrollArea className="h-full">{children}</ScrollArea>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </SidebarProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}
