"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { ClipboardList, Settings } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LogoutButton } from "@/components/logout-button";
import { FileExplorerPanel } from "@/components/explorer/file-explorer-panel";
import { ChatHistoryPanel } from "@/components/explorer/chat-history-panel";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";

const BOTTOM_NAV = [
  { href: "/settings", label: "Configuración", icon: Settings },
] as const;

const AUDIT_ITEM = { href: "/audit", label: "Auditoría", icon: ClipboardList };

export function SidebarLeft({ showAudit }: { showAudit: boolean }) {
  const pathname = usePathname();
  const bottomItems = showAudit ? [...BOTTOM_NAV, AUDIT_ITEM] : BOTTOM_NAV;
  const { setActiveThreadId } = useChatThreads();

  // Pedimos al contexto que cambie el thread — ChatWithRuntime reacciona y hace switchToNewThread.
  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
    },
    [setActiveThreadId],
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
        {/* Panel superior: explorador de archivos */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FileExplorerPanel />
        </div>

        {/* Panel inferior: historial de chats */}
        <div className="flex h-52 shrink-0 flex-col overflow-hidden">
          <ChatHistoryPanel
            onNewChat={handleNewChat}
            onSelectThread={handleSelectThread}
          />
        </div>
      </SidebarContent>

      {/* Nav inferior (Configuración, Auditoría) */}
      <SidebarFooter>
        <SidebarMenu>
          {bottomItems.map(({ href, label, icon: Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                render={<a href={href} />}
                isActive={pathname === href || pathname.startsWith(href + "/")}
                tooltip={label}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <LogoutButton />
      </SidebarFooter>
    </Sidebar>
  );
}
