"use client";

import { useCallback, useEffect, useState } from "react";
import { AssistantRuntimeProvider, useAssistantRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { useWorkyAiRuntime } from "@/lib/assistant-ui/workyai-runtime";
import { SeoStepsProvider, useSeoSteps } from "@/lib/contexts/seo-steps-context";
import { getThread, type ThreadRun } from "@/lib/assistant-ui/threads-api";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat/chat-header";
import type { TenantOption } from "@/lib/types/tenant";

function runsToMessages(runs: ThreadRun[]): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  for (const run of runs) {
    if (run.status !== "completed" || !run.output_message) continue;
    messages.push({
      role: "user",
      content: [{ type: "text", text: run.input_message }],
    });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: run.output_message }],
      metadata: {
        custom: { citations: run.citations ?? [], run_id: run.run_id },
      },
    });
  }
  return messages;
}

export function ChatPageClient({ tenants }: { tenants: TenantOption[] }) {
  const { activeTenantId } = useWorkspace();

  if (!activeTenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Seleccioná un espacio en la barra superior para comenzar
        </p>
      </div>
    );
  }

  return (
    <SeoStepsProvider>
      <ChatManager tenantId={activeTenantId} />
    </SeoStepsProvider>
  );
}

function ChatManager({ tenantId }: { tenantId: string }) {
  const { activeThreadId, setActiveThreadId, refresh } = useChatThreads();
  const [initialMessages, setInitialMessages] = useState<readonly ThreadMessageLike[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  // Cuando cambia el thread activo, cargar su historial para hidratar el runtime.
  useEffect(() => {
    if (!activeThreadId) {
      setInitialMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingThread(true);
    getThread(tenantId, activeThreadId)
      .then((detail) => {
        if (!cancelled) setInitialMessages(runsToMessages(detail.runs));
      })
      .catch(() => {
        if (!cancelled) setInitialMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => { cancelled = true; };
  }, [activeThreadId, tenantId]);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
    setInitialMessages([]);
  }, [setActiveThreadId]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
    },
    [setActiveThreadId],
  );

  // key fuerza re-mount de ChatInner (y del runtime) cuando cambia el thread,
  // para que useLocalRuntime reciba los initialMessages correctos en su useState.
  return (
    <ChatInner
      key={activeThreadId ?? "new"}
      tenantId={tenantId}
      activeThreadId={activeThreadId}
      initialMessages={initialMessages}
      loadingThread={loadingThread}
      refresh={refresh}
      onNewChat={handleNewChat}
      onSelectThread={handleSelectThread}
    />
  );
}

function ChatInner({
  tenantId,
  activeThreadId,
  initialMessages,
  loadingThread,
  refresh,
  onNewChat,
  onSelectThread,
}: {
  tenantId: string;
  activeThreadId: string | null;
  initialMessages: readonly ThreadMessageLike[];
  loadingThread: boolean;
  refresh: () => void;
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const { onRunStart, onRunComplete, onRunEnd } = useSeoSteps();
  const { runtime, threadIdRef } = useWorkyAiRuntime(
    tenantId,
    { onRunStart, onRunComplete, onRunEnd },
    initialMessages,
  );

  // Sincronizar el threadIdRef con el thread activo al montar.
  threadIdRef.current = activeThreadId;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWithRuntime
        tenantId={tenantId}
        activeThreadId={activeThreadId}
        threadIdRef={threadIdRef}
        loadingThread={loadingThread}
        refresh={refresh}
        onNewChat={onNewChat}
        onSelectThread={onSelectThread}
      />
    </AssistantRuntimeProvider>
  );
}

function ChatWithRuntime({
  tenantId,
  activeThreadId,
  threadIdRef,
  loadingThread,
  refresh,
  onNewChat,
  onSelectThread,
}: {
  tenantId: string;
  activeThreadId: string | null;
  threadIdRef: React.MutableRefObject<string | null>;
  loadingThread: boolean;
  refresh: () => void;
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const runtime = useAssistantRuntime();

  // Refrescar lista de threads tras cada run completado.
  useEffect(() => {
    const unsub = runtime.thread.subscribe(() => {
      void refresh();
    });
    return unsub;
  }, [runtime, refresh]);

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        tenantId={tenantId}
        activeThreadId={activeThreadId}
        onSelectThread={onSelectThread}
        onNewChat={onNewChat}
      />
      <div className="relative min-h-0 flex-1">
        {loadingThread && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <p className="text-sm text-muted-foreground">Cargando conversación…</p>
          </div>
        )}
        <Thread className="h-full" />
      </div>
    </div>
  );
}
