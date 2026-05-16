"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebGroundingContext } from "@/lib/contexts/web-grounding-context";
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
import type { AgentRuntimeCallbacks } from "@/lib/assistant-ui/workyai-runtime";

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
          web_sources: run.web_sources ?? [],
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
  const agentSteps = useAgentSteps();
  const agentStepsRef = useRef(agentSteps);
  agentStepsRef.current = agentSteps;

  const { threads, upsertThread } = useChatThreads();
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const upsertThreadRef = useRef(upsertThread);
  upsertThreadRef.current = upsertThread;

  const tenantIdRef = useRef(tenantId);
  tenantIdRef.current = tenantId;
  const onNewThreadRef = useRef(onNewThread);
  onNewThreadRef.current = onNewThread;

  const { mentionsRef, clearMentions } = useMentions();
  const clearMentionsRef = useRef(clearMentions);
  clearMentionsRef.current = clearMentions;

  const callbacksRef = useRef<AgentRuntimeCallbacks>({
    onRunStart: () => agentStepsRef.current.onRunStart(),
    onRunComplete: (turnIndex, steps) => {
      agentStepsRef.current.onRunComplete(turnIndex, steps);
      clearMentionsRef.current();
    },
    onRunEnd: () => agentStepsRef.current.onRunEnd(),
    onStepProgress: (...args) => agentStepsRef.current.onStepProgress(...args),
    onToolProgress: (...args) => agentStepsRef.current.onToolProgress(...args),
    onThreadUpdate: (threadId) => {
      onNewThreadRef.current(threadId);
      if (threadsRef.current.some((t) => t.id === threadId)) return;
      getThread(tenantIdRef.current, threadId)
        .then((detail) =>
          upsertThreadRef.current({
            id: detail.id,
            title: detail.title,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
          }),
        )
        .catch(() => {});
    },
  });

  return (
    <ChatRuntimeShell
      tenantId={tenantId}
      activeThreadId={activeThreadId}
      threadTitleHint={threadTitleHint}
      initialMessages={initialMessages}
      onNewChat={onNewChat}
      callbacksRef={callbacksRef}
      mentionsRef={mentionsRef}
    />
  );
}

const ChatRuntimeShell = memo(function ChatRuntimeShell({
  tenantId,
  activeThreadId,
  threadTitleHint,
  initialMessages,
  onNewChat,
  callbacksRef,
  mentionsRef,
}: {
  tenantId: string;
  activeThreadId: string | null;
  threadTitleHint: string | null;
  initialMessages: readonly ThreadMessageLike[];
  onNewChat: () => void;
  callbacksRef: React.RefObject<AgentRuntimeCallbacks>;
  mentionsRef: ReturnType<typeof useMentions>["mentionsRef"];
}) {
  const stableMessages = useMemo(() => initialMessages, [initialMessages]);

  const webGroundingRef = useRef(false);
  const [webGroundingEnabled, setWebGroundingEnabled] = useState(false);
  const toggleWebGrounding = useCallback(() => {
    const next = !webGroundingRef.current;
    webGroundingRef.current = next;
    setWebGroundingEnabled(next);
  }, []);

  const { runtime } = useWorkyAiRuntime(
    tenantId,
    callbacksRef,
    stableMessages,
    activeThreadId,
    mentionsRef,
    webGroundingRef,
  );

  const webGroundingCtx = useMemo(
    () => ({ enabled: webGroundingEnabled, toggle: toggleWebGrounding }),
    [webGroundingEnabled, toggleWebGrounding],
  );

  return (
    <WebGroundingContext.Provider value={webGroundingCtx}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ChatWithRuntime
          activeThreadId={activeThreadId}
          threadTitleHint={threadTitleHint}
          onNewChat={onNewChat}
        />
      </AssistantRuntimeProvider>
    </WebGroundingContext.Provider>
  );
});

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
