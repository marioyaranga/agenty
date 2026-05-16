"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AssistantRuntimeProvider, type ThreadMessageLike } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { useWorkyAiRuntime } from "@/lib/assistant-ui/workyai-runtime";
import { AgentStepsProvider, useAgentSteps } from "@/lib/contexts/agent-steps-context";
import { MentionsProvider, useMentions } from "@/lib/contexts/mentions-context";
import { getThread, type ThreadRun } from "@/lib/assistant-ui/threads-api";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat/chat-header";
import type { TenantOption } from "@/lib/types/tenant";
import type { AgentRunStep } from "@/lib/types/agent-steps";

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
        custom: {
          citations: run.citations ?? [],
          run_id: run.run_id,
          steps: run.steps ?? [],
        },
      },
    });
  }
  return messages;
}

export function ChatPageClient({
  tenants,
  initialThreadId,
}: {
  tenants: TenantOption[];
  initialThreadId?: string;
}) {
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
    <AgentStepsProvider>
      <MentionsProvider>
        <ChatManager tenantId={activeTenantId} initialThreadId={initialThreadId} />
      </MentionsProvider>
    </AgentStepsProvider>
  );
}

function ChatManager({
  tenantId,
  initialThreadId,
}: {
  tenantId: string;
  initialThreadId?: string;
}) {
  const { setActiveThreadId } = useChatThreads();
  const router = useRouter();

  // Sincroniza el highlight del sidebar con el thread de la URL.
  useEffect(() => {
    setActiveThreadId(initialThreadId ?? null);
  }, [initialThreadId, setActiveThreadId]);

  // null = fetch en curso; objeto = listo para montar ChatInner con datos consistentes.
  const [hydrated, setHydrated] = useState<HydratedThread | null>(
    initialThreadId ? null : { threadId: null, messages: [], title: null },
  );

  // Hidratar de forma atómica basado en el param de URL, no en el contexto.
  useEffect(() => {
    if (!initialThreadId) {
      setHydrated({ threadId: null, messages: [], title: null });
      return;
    }
    let cancelled = false;
    setHydrated(null); // loading
    getThread(tenantId, initialThreadId)
      .then((detail) => {
        if (!cancelled)
          setHydrated({
            threadId: initialThreadId,
            messages: runsToMessages(detail.runs),
            title: detail.title,
          });
      })
      .catch(() => {
        if (!cancelled)
          setHydrated({
            threadId: initialThreadId,
            messages: [],
            title: null,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [initialThreadId, tenantId]);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
    router.push("/chat");
  }, [setActiveThreadId, router]);

  // Cuando el primer mensaje crea un thread nuevo mid-stream: actualiza la URL
  // sin provocar una navegación de Next.js (no remonta el componente).
  const handleNewThread = useCallback(
    (threadId: string) => {
      window.history.replaceState(null, "", `/chat/${threadId}`);
      setActiveThreadId(threadId);
    },
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
      threadTitleHint={hydrated.title}
      initialMessages={hydrated.messages}
      onNewChat={handleNewChat}
      onNewThread={handleNewThread}
    />
  );
}

function ChatInner({
  tenantId,
  activeThreadId,
  threadTitleHint,
  initialMessages,
  onNewChat,
  onNewThread,
}: {
  tenantId: string;
  activeThreadId: string | null;
  threadTitleHint: string | null;
  initialMessages: readonly ThreadMessageLike[];
  onNewChat: () => void;
  onNewThread: (threadId: string) => void;
}) {
  const { onRunStart, onRunComplete, onRunEnd, onStepProgress, onToolProgress } =
    useAgentSteps();
  const { threads, upsertThread } = useChatThreads();
  const { mentionsRef, clearMentions } = useMentions();

  const handleThreadUpdate = useCallback(
    (threadId: string) => {
      onNewThread(threadId);
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
    [threads, tenantId, upsertThread, onNewThread],
  );

  const handleRunComplete = useCallback(
    (turnIndex: number, steps: AgentRunStep[]) => {
      onRunComplete(turnIndex, steps);
      clearMentions();
    },
    [onRunComplete, clearMentions],
  );

  const { runtime } = useWorkyAiRuntime(
    tenantId,
    {
      onRunStart,
      onRunComplete: handleRunComplete,
      onRunEnd,
      onThreadUpdate: handleThreadUpdate,
      onStepProgress,
      onToolProgress,
    },
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
    <div className="flex h-full min-w-0 flex-col">
      <ChatHeader
        key={activeThreadId ?? "new"}
        activeThreadId={activeThreadId}
        threadTitleHint={threadTitleHint}
        onNewChat={onNewChat}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <Thread className="h-full" />
      </div>
    </div>
  );
}
