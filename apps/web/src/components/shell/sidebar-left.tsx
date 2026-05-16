"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
    router.push("/chat");
  }, [setActiveThreadId, router]);

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
