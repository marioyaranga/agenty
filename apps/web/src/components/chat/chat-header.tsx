"use client";

import { Plus, MessageSquare } from "lucide-react";

type Props = {
  tenantId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
};

export function ChatHeader({ activeThreadId, onNewChat }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <MessageSquare size={14} className="text-muted-foreground" />
        <span className="max-w-[280px] truncate text-sm text-muted-foreground">
          {activeThreadId ? "Conversación activa" : "Nueva conversación"}
        </span>
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Nuevo chat"
      >
        <Plus size={14} />
        Nuevo
      </button>
    </div>
  );
}
