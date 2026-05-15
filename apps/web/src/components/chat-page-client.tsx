"use client";

import { useCallback, useEffect, useRef } from "react";
import { AssistantRuntimeProvider, useAssistantRuntime } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { useWorkyAiRuntime } from "@/lib/assistant-ui/workyai-runtime";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat/chat-header";
import { ViewerBridge } from "@/components/chat/viewer-bridge";
import type { TenantOption } from "@/lib/types/tenant";

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

  return <ChatInner tenantId={activeTenantId} />;
}

function ChatInner({ tenantId }: { tenantId: string }) {
  const { runtime, threadIdRef } = useWorkyAiRuntime(tenantId);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWithRuntime tenantId={tenantId} threadIdRef={threadIdRef} />
    </AssistantRuntimeProvider>
  );
}

function ChatWithRuntime({
  tenantId,
  threadIdRef,
}: {
  tenantId: string;
  threadIdRef: React.MutableRefObject<string | null>;
}) {
  const runtime = useAssistantRuntime();
  const { activeThreadId, setActiveThreadId, refresh } = useChatThreads();
  const prevActiveThreadId = useRef(activeThreadId);

  // Cuando el contexto global cambia el thread (desde el sidebar), sincronizar el runtime.
  useEffect(() => {
    if (prevActiveThreadId.current === activeThreadId) return;
    prevActiveThreadId.current = activeThreadId;
    threadIdRef.current = activeThreadId;
    runtime.switchToNewThread();
  }, [activeThreadId, runtime, threadIdRef]);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
    threadIdRef.current = null;
    runtime.switchToNewThread();
  }, [runtime, threadIdRef, setActiveThreadId]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
      threadIdRef.current = threadId;
      runtime.switchToNewThread();
    },
    [runtime, threadIdRef, setActiveThreadId],
  );

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
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
      />
      <div className="min-h-0 flex-1">
        <Thread className="h-full" />
      </div>
      <ViewerBridge />
    </div>
  );
}
