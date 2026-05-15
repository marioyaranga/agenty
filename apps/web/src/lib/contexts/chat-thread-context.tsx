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

const PAGE_SIZE = 15;

type ChatThreadState = {
  threads: ThreadItem[];
  activeThreadId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  setActiveThreadId: (id: string | null) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  upsertThread: (item: ThreadItem) => void;
  renameActiveThread: (title: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
};

const ChatThreadContext = createContext<ChatThreadState | null>(null);

export function ChatThreadProvider({ children }: { children: React.ReactNode }) {
  const { activeTenantId } = useWorkspace();
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadedTenantRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await listThreads(activeTenantId, { limit: PAGE_SIZE });
      setThreads(res.items);
      setNextCursor(res.next_cursor);
    } catch {
      setThreads([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  const loadMore = useCallback(async () => {
    if (!activeTenantId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listThreads(activeTenantId, { limit: PAGE_SIZE, cursor: nextCursor });
      setThreads((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } catch {
      /* silencioso */
    } finally {
      setLoadingMore(false);
    }
  }, [activeTenantId, nextCursor, loadingMore]);

  useEffect(() => {
    if (!activeTenantId) return;
    if (loadedTenantRef.current === activeTenantId) return;
    loadedTenantRef.current = activeTenantId;
    void refresh();
  }, [activeTenantId, refresh]);

  const upsertThread = useCallback((item: ThreadItem) => {
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === item.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [item, ...prev];
    });
  }, []);

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
        loadingMore,
        hasMore: nextCursor !== null,
        setActiveThreadId,
        refresh,
        loadMore,
        upsertThread,
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
