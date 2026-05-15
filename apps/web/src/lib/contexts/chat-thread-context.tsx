"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  listThreads,
  deleteThread,
  renameThread,
  type ThreadItem,
} from "@/lib/assistant-ui/threads-api";
import { useWorkspace } from "@/lib/contexts/workspace-context";

type ChatThreadState = {
  threads: ThreadItem[];
  activeThreadId: string | null;
  loading: boolean;
  setActiveThreadId: (id: string | null) => void;
  refresh: () => Promise<void>;
  renameActiveThread: (title: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
};

const ChatThreadContext = createContext<ChatThreadState | null>(null);

export function ChatThreadProvider({ children }: { children: React.ReactNode }) {
  const { activeTenantId } = useWorkspace();
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedTenantRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await listThreads(activeTenantId, { limit: 50 });
      setThreads(res.items);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    if (!activeTenantId) return;
    if (loadedTenantRef.current === activeTenantId) return;
    loadedTenantRef.current = activeTenantId;
    void refresh();
  }, [activeTenantId, refresh]);

  const renameActiveThread = useCallback(
    async (title: string) => {
      if (!activeTenantId || !activeThreadId) return;
      const updated = await renameThread(activeTenantId, activeThreadId, title);
      setThreads((prev) =>
        prev.map((t) => (t.id === activeThreadId ? updated : t)),
      );
    },
    [activeTenantId, activeThreadId],
  );

  const removeThread = useCallback(
    async (id: string) => {
      if (!activeTenantId) return;
      await deleteThread(activeTenantId, id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) setActiveThreadId(null);
    },
    [activeTenantId, activeThreadId],
  );

  return (
    <ChatThreadContext
      value={{
        threads,
        activeThreadId,
        loading,
        setActiveThreadId,
        refresh,
        renameActiveThread,
        removeThread,
      }}
    >
      {children}
    </ChatThreadContext>
  );
}

export function useChatThreads(): ChatThreadState {
  const ctx = useContext(ChatThreadContext);
  if (!ctx)
    throw new Error("useChatThreads must be used inside ChatThreadProvider");
  return ctx;
}
