"use client";

import { useCallback, useState } from "react";
import { AssistantRuntimeProvider, useAssistantRuntime } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useWorkyAiRuntime } from "@/lib/assistant-ui/workyai-runtime";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat/chat-header";
import { ViewerBridge } from "@/components/chat/viewer-bridge";
import type { ThreadItem } from "@/lib/assistant-ui/threads-api";
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
  const [activeThread, setActiveThread] = useState<ThreadItem | null>(null);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWithRuntime
        tenantId={tenantId}
        threadIdRef={threadIdRef}
        activeThread={activeThread}
        setActiveThread={setActiveThread}
      />
    </AssistantRuntimeProvider>
  );
}

type InnerProps = {
  tenantId: string;
  threadIdRef: React.MutableRefObject<string | null>;
  activeThread: ThreadItem | null;
  setActiveThread: (t: ThreadItem | null) => void;
};

function ChatWithRuntime({
  tenantId,
  threadIdRef,
  activeThread,
  setActiveThread,
}: InnerProps) {
  const runtime = useAssistantRuntime();

  const handleNewChat = useCallback(() => {
    threadIdRef.current = null;
    setActiveThread(null);
    runtime.switchToNewThread();
  }, [runtime, threadIdRef, setActiveThread]);

  const handleSelectThread = useCallback(
    (thread: ThreadItem) => {
      threadIdRef.current = thread.id;
      setActiveThread(thread);
      runtime.switchToNewThread();
    },
    [runtime, threadIdRef, setActiveThread],
  );

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        tenantId={tenantId}
        activeThread={activeThread}
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
