"use client";

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/lib/contexts/workspace-context";
import { ViewerProvider } from "@/lib/contexts/viewer-context";
import { ChatThreadProvider } from "@/lib/contexts/chat-thread-context";
import { SidebarLeft } from "@/components/shell/sidebar-left";
import { TopBar } from "@/components/shell/topbar";
import { MarkdownViewerPanel } from "@/components/viewer/markdown-viewer-panel";
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
        <ChatThreadProvider>
        <ViewerProvider>
          <SidebarProvider className="h-full min-h-0">
            <SidebarLeft userEmail={userEmail} showAudit={showAudit} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <TopBar />
              <ResizablePanelGroup
                className="flex-1 overflow-hidden"
              >
                <ResizablePanel id="center" minSize={20} defaultSize={35}>
                  <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden">
                    {children}
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="viewer"
                  minSize={35}
                  defaultSize={65}
                  collapsible
                >
                  <MarkdownViewerPanel />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </SidebarProvider>
        </ViewerProvider>
        </ChatThreadProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}
