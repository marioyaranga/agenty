"use client";

import { useCallback } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ChatHistoryPanel({
  onNewChat,
  onSelectThread,
}: {
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const { threads, activeThreadId, loading, loadingMore, hasMore, removeThread, loadMore } = useChatThreads();
  const router = useRouter();

  const handleSelect = useCallback(
    (threadId: string) => {
      onSelectThread(threadId);
      router.push("/chat");
    },
    [onSelectThread, router],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      const confirmed = window.confirm("¿Eliminar esta conversación?");
      if (!confirmed) return;
      try {
        await removeThread(threadId);
      } catch {
        /* silencioso */
      }
    },
    [removeThread],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-t px-2 py-1.5">
        <span className="text-xs font-semibold text-sidebar-foreground">
          Conversaciones
        </span>
        <button
          type="button"
          title="Nuevo chat"
          onClick={onNewChat}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Lista */}
      <ScrollArea className="min-h-0 flex-1">
        {loading && threads.length === 0 ? (
          <div className="px-2 py-2 space-y-1">
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-4">
            <p className="text-center text-xs text-muted-foreground">
              Sin conversaciones previas
            </p>
          </div>
        ) : (
          <ul className="py-1">
            {threads.map((t) => (
              <li key={t.id} className="group">
                <button
                  type="button"
                  onClick={() => handleSelect(t.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60",
                    activeThreadId === t.id && "bg-accent font-medium",
                  )}
                >
                  <MessageSquare
                    size={12}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(e, t.id)}
                    className="hidden shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover:flex"
                    title="Eliminar conversación"
                  >
                    <Trash2 size={11} />
                  </button>
                </button>
              </li>
            ))}
            {hasMore && (
              <li>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {loadingMore ? "Cargando…" : "Ver más"}
                </button>
              </li>
            )}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
