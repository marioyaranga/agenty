"use client";

import { useCallback } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { FileExplorerPanel } from "@/components/explorer/file-explorer-panel";
import { ChatHistoryPanel } from "@/components/explorer/chat-history-panel";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { SidebarLeftFooterAccount } from "@/components/shell/sidebar-left-footer-account";

export function SidebarLeft({
  userEmail,
  showAudit,
}: {
  userEmail: string;
  showAudit: boolean;
}) {
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

      {/* Cuenta, espacio, configuración y cierre (estilo sidebar-07) */}
      <SidebarFooter>
        <SidebarLeftFooterAccount
          userEmail={userEmail}
          showAudit={showAudit}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
