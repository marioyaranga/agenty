"use client";

/**
 * Hilos de chat por tenant: lista paginada, hilo activo, alta/baja y renombre.
 * `renameThreadById` alimenta el diálogo del historial; `renameActiveThread` la cabecera del chat.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import useSWRInfinite from "swr/infinite";
import {
  listThreads,
  deleteThread,
  renameThread,
  type ThreadItem,
  type ThreadsListResponse,
} from "@/lib/assistant-ui/threads-api";
import { useWorkspace } from "@/lib/contexts/workspace-context";

const PAGE_SIZE = 15;

type ThreadPageKey = [string, string | null]; // [tenantId, cursor]

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
  /** PATCH del título para cualquier hilo (p. ej. menú en el panel lateral). */
  renameThreadById: (threadId: string, title: string) => Promise<void>;
  renameActiveThread: (title: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
};

const ChatThreadContext = createContext<ChatThreadState | null>(null);

export function ChatThreadProvider({ children }: { children: React.ReactNode }) {
  const { activeTenantId } = useWorkspace();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const prevTenantRef = useRef<string | null>(null);

  const getKey = (
    i: number,
    prev: ThreadsListResponse | null,
  ): ThreadPageKey | null => {
    if (!activeTenantId) return null;
    if (i === 0) return [activeTenantId, null];
    if (!prev?.next_cursor) return null;
    return [activeTenantId, prev.next_cursor];
  };

  const { data, size, setSize, mutate, isLoading } =
    useSWRInfinite<ThreadsListResponse>(
      getKey,
      ([tid, cursor]: ThreadPageKey) =>
        listThreads(tid, { limit: PAGE_SIZE, cursor: cursor ?? undefined }),
      {
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        revalidateFirstPage: false,
        dedupingInterval: 5000,
      },
    );

  // Resetear paginación al cambiar de tenant
  useEffect(() => {
    if (prevTenantRef.current !== activeTenantId) {
      prevTenantRef.current = activeTenantId;
      void setSize(1);
    }
  }, [activeTenantId, setSize]);

  const threads = data?.flatMap((p) => p.items) ?? [];
  const hasMore = !!data?.[data.length - 1]?.next_cursor;
  const loading = isLoading;

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await setSize((s) => s + 1);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, setSize]);

  const upsertThread = useCallback(
    (item: ThreadItem) => {
      void mutate(
        (pages) =>
          pages?.length
            ? [
                {
                  ...pages[0],
                  items: pages[0].items.some((t) => t.id === item.id)
                    ? pages[0].items.map((t) => (t.id === item.id ? item : t))
                    : [item, ...pages[0].items],
                },
                ...pages.slice(1),
              ]
            : [{ items: [item], next_cursor: null }],
        false,
      );
    },
    [mutate],
  );

  const renameThreadById = useCallback(
    async (threadId: string, title: string) => {
      if (!activeTenantId) return;
      const trimmed = title.trim();
      if (!trimmed) return;
      const updated = await renameThread(
        activeTenantId,
        threadId,
        trimmed.slice(0, 200),
      );
      void mutate(
        (pages) =>
          pages?.map((p) => ({
            ...p,
            items: p.items.map((t) => (t.id === threadId ? updated : t)),
          })),
        false,
      );
    },
    [activeTenantId, mutate],
  );

  const renameActiveThread = useCallback(
    async (title: string) => {
      if (!activeThreadId) return;
      await renameThreadById(activeThreadId, title);
    },
    [activeThreadId, renameThreadById],
  );

  const removeThread = useCallback(
    async (id: string) => {
      if (!activeTenantId) return;
      await deleteThread(activeTenantId, id);
      void mutate(
        (pages) =>
          pages?.map((p) => ({
            ...p,
            items: p.items.filter((t) => t.id !== id),
          })),
        false,
      );
      if (activeThreadId === id) setActiveThreadId(null);
    },
    [activeTenantId, activeThreadId, mutate],
  );

  return (
    <ChatThreadContext
      value={{
        threads,
        activeThreadId,
        loading,
        loadingMore,
        hasMore,
        setActiveThreadId,
        refresh,
        loadMore,
        upsertThread,
        renameThreadById,
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
