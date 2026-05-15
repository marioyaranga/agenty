"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, type ThreadMessageLike } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { useWorkyAiRuntime } from "@/lib/assistant-ui/workyai-runtime";
import { SeoStepsProvider, useSeoSteps } from "@/lib/contexts/seo-steps-context";
import { MentionsProvider, useMentions, type Mention } from "@/lib/contexts/mentions-context";
import { getThread, type ThreadRun } from "@/lib/assistant-ui/threads-api";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat/chat-header";
import type { TenantOption } from "@/lib/types/tenant";
import type { SeoSubagentStep } from "@/lib/types/seo-agent";

type HydratedThread = {
  threadId: string | null;
  messages: readonly ThreadMessageLike[];
  /** Título del GET /threads/:id (cabecera y renombre hasta que figure en la lista paginada). */
  title: string | null;
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
      <MentionsProvider>
        <ChatManager tenantId={activeTenantId} />
      </MentionsProvider>
    </SeoStepsProvider>
  );
}

function ChatManager({ tenantId }: { tenantId: string }) {
  const { activeThreadId, setActiveThreadId } = useChatThreads();
  // null = fetch en curso; objeto = listo para montar ChatInner con datos consistentes.
  const [hydrated, setHydrated] = useState<HydratedThread | null>({
    threadId: null,
    messages: [],
    title: null,
  });

  // Hidratar de forma atómica: no montar ChatInner hasta tener threadId + messages sincronizados.
  useEffect(() => {
    if (!activeThreadId) {
      setHydrated({ threadId: null, messages: [], title: null });
      return;
    }
    let cancelled = false;
    setHydrated(null); // loading
    getThread(tenantId, activeThreadId)
      .then((detail) => {
        if (!cancelled)
          setHydrated({
            threadId: activeThreadId,
            messages: runsToMessages(detail.runs),
            title: detail.title,
          });
      })
      .catch(() => {
        if (!cancelled)
          setHydrated({
            threadId: activeThreadId,
            messages: [],
            title: null,
          });
      });
    return () => { cancelled = true; };
  }, [activeThreadId, tenantId]);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

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
      threadTitleHint={hydrated.title}
      initialMessages={hydrated.messages}
      onNewChat={handleNewChat}
    />
  );
}

function ChatInner({
  tenantId,
  activeThreadId,
  threadTitleHint,
  initialMessages,
  onNewChat,
}: {
  tenantId: string;
  activeThreadId: string | null;
  threadTitleHint: string | null;
  initialMessages: readonly ThreadMessageLike[];
  onNewChat: () => void;
}) {
  const { onRunStart, onRunComplete, onRunEnd } = useSeoSteps();
  const { threads, upsertThread } = useChatThreads();
  const { mentionsRef, clearMentions } = useMentions();

  const handleThreadUpdate = useCallback(
    (threadId: string) => {
      if (threads.some((t) => t.id === threadId)) return;
      getThread(tenantId, threadId)
        .then((detail) =>
          upsertThread({
            id: detail.id,
            title: detail.title,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
          }),
        )
        .catch(() => {});
    },
    [threads, tenantId, upsertThread],
  );

  const handleRunComplete = useCallback(
    (turnIndex: number, steps: SeoSubagentStep[]) => {
      onRunComplete(turnIndex, steps);
      clearMentions();
    },
    [onRunComplete, clearMentions],
  );

  const { runtime } = useWorkyAiRuntime(
    tenantId,
    { onRunStart, onRunComplete: handleRunComplete, onRunEnd, onThreadUpdate: handleThreadUpdate },
    initialMessages,
    activeThreadId,
    mentionsRef,
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatWithRuntime
        activeThreadId={activeThreadId}
        threadTitleHint={threadTitleHint}
        onNewChat={onNewChat}
      />
    </AssistantRuntimeProvider>
  );
}

function ChatWithRuntime({
  activeThreadId,
  threadTitleHint,
  onNewChat,
}: {
  activeThreadId: string | null;
  threadTitleHint: string | null;
  onNewChat: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        key={activeThreadId ?? "new"}
        activeThreadId={activeThreadId}
        threadTitleHint={threadTitleHint}
        onNewChat={onNewChat}
      />
      <div className="min-h-0 flex-1">
        <Thread className="h-full" />
      </div>
    </div>
  );
}
