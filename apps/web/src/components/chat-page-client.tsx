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

type HydratedThread = {
  threadId: string | null;
  messages: readonly ThreadMessageLike[];
};

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
  // null = fetch en curso; objeto = listo para montar ChatInner con datos consistentes.
  const [hydrated, setHydrated] = useState<HydratedThread | null>({
    threadId: null,
    messages: [],
  });

  // Hidratar de forma atómica: no montar ChatInner hasta tener threadId + messages sincronizados.
  useEffect(() => {
    if (!activeThreadId) {
      setHydrated({ threadId: null, messages: [] });
      return;
    }
    let cancelled = false;
    setHydrated(null); // loading
    getThread(tenantId, activeThreadId)
      .then((detail) => {
        if (!cancelled) setHydrated({ threadId: activeThreadId, messages: runsToMessages(detail.runs) });
      })
      .catch(() => {
        if (!cancelled) setHydrated({ threadId: activeThreadId, messages: [] });
      });
    return () => { cancelled = true; };
  }, [activeThreadId, tenantId]);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  const handleSelectThread = useCallback(
    (threadId: string) => setActiveThreadId(threadId),
    [setActiveThreadId],
  );

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando conversación…</p>
      </div>
    );
  }

  return (
    <ChatInner
      key={hydrated.threadId ?? "new"}
      tenantId={tenantId}
      activeThreadId={hydrated.threadId}
      initialMessages={hydrated.messages}
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
  refresh,
  onNewChat,
  onSelectThread,
}: {
  tenantId: string;
  activeThreadId: string | null;
  initialMessages: readonly ThreadMessageLike[];
  refresh: () => void;
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const { onRunStart, onRunComplete, onRunEnd } = useSeoSteps();
  const { runtime, threadIdRef } = useWorkyAiRuntime(
    tenantId,
    { onRunStart, onRunComplete, onRunEnd },
    initialMessages,
    activeThreadId,
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWithRuntime
        tenantId={tenantId}
        activeThreadId={activeThreadId}
        threadIdRef={threadIdRef}
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
  refresh,
  onNewChat,
  onSelectThread,
}: {
  tenantId: string;
  activeThreadId: string | null;
  threadIdRef: React.MutableRefObject<string | null>;
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
      <div className="min-h-0 flex-1">
        <Thread className="h-full" />
      </div>
    </div>
  );
}
