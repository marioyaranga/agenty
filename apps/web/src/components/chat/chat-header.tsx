"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, MessageSquare } from "lucide-react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { listThreads, type ThreadItem } from "@/lib/assistant-ui/threads-api";
import { cn } from "@/lib/utils";

type Props = {
  tenantId: string;
  activeThread: ThreadItem | null;
  onSelectThread: (thread: ThreadItem) => void;
  onNewChat: () => void;
};

export function ChatHeader({
  tenantId,
  activeThread,
  onSelectThread,
  onNewChat,
}: Props) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    setLoading(true);
    listThreads(tenantId, { limit: 20 })
      .then((r) => setThreads(r.items))
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [open, tenantId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-2">
      {/* Selector de thread */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!tenantId}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <MessageSquare size={14} className="text-muted-foreground" />
          <span className="max-w-[200px] truncate">
            {activeThread?.title ?? "Nueva conversación"}
          </span>
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border bg-popover shadow-lg">
            {loading ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Cargando…
              </div>
            ) : threads.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Sin conversaciones previas
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectThread(t);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                        activeThread?.id === t.id &&
                          "bg-accent/60 font-medium",
                      )}
                    >
                      <MessageSquare
                        size={13}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Nuevo chat */}
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
