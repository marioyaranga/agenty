"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, StopCircle, ChevronDown, FileText } from "lucide-react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";
import { ScrollBar } from "@/components/ui/scroll-area";
import { useOptionalAgentSteps } from "@/lib/contexts/agent-steps-context";
import { AgentStepsPanel } from "@/components/chat/agent-steps-panel";
import type { AgentRunStep } from "@/lib/types/agent-steps";
import { useMentions } from "@/lib/contexts/mentions-context";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useViewer } from "@/lib/contexts/viewer-context";
import { fetchDocumentContent } from "@/lib/api/documents";
import { createClient } from "@/lib/supabase/client";

type DocOption = { id: string; title: string; mime_type: string };

async function fetchDocumentSuggestions(
  tenantId: string,
  search: string,
  signal: AbortSignal,
): Promise<DocOption[]> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return [];
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  const params = new URLSearchParams({ search });
  const res = await fetch(
    `${apiBase}/v1/tenants/${tenantId}/documents?${params}`,
    {
      signal,
      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
    },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.documents ?? []).slice(0, 8) as DocOption[];
}

// ---------------------------------------------------------------------------
// Thread principal
// ---------------------------------------------------------------------------

export function Thread({ className }: { className?: string }) {
  return (
    <ThreadPrimitive.Root
      className={cn("relative flex h-full min-w-0 flex-col overflow-hidden", className)}
    >
      <ScrollAreaPrimitive.Root
        data-slot="scroll-area"
        className="relative min-h-0 flex-1"
      >
        <ThreadPrimitive.Viewport
          asChild
          className={cn(
            "flex min-w-0 flex-col gap-4 px-4 py-6",
            "size-full rounded-[inherit] transition-[color,box-shadow] outline-none",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          )}
        >
          <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport">
            <ThreadPrimitive.Empty>
              <WelcomeScreen />
            </ThreadPrimitive.Empty>

            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />

            <RunningStepsInline />

            <div className="min-h-8 shrink-0" aria-hidden />
          </ScrollAreaPrimitive.Viewport>
        </ThreadPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>

      <ThreadPrimitive.ScrollToBottom asChild>
        <button
          type="button"
          className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm transition-all hover:text-foreground data-[visible=false]:pointer-events-none data-[visible=false]:opacity-0"
        >
          <ChevronDown size={14} />
          Bajar
        </button>
      </ThreadPrimitive.ScrollToBottom>

      <Composer />
    </ThreadPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Pasos SEO en tiempo real (visible durante el run)
// ---------------------------------------------------------------------------

function RunningStepsInline() {
  const steps = useOptionalAgentSteps();
  if (!steps?.isRunning || !steps.activeSteps?.length) return null;

  return (
    <div className="flex w-full min-w-0 justify-start gap-3 pl-10">
      <AgentStepsPanel steps={steps.activeSteps} defaultOpen />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn index helper (para asociar pasos al mensaje del asistente correcto)
// ---------------------------------------------------------------------------

function useAssistantTurnIndex(): number {
  return useAuiState((s) => {
    const messages = s.thread.messages;
    const idx = messages.findIndex((m) => m.id === s.message.id);
    if (idx < 0) return 0;
    return messages.slice(0, idx + 1).filter((m) => m.role === "assistant")
      .length - 1;
  });
}

// ---------------------------------------------------------------------------
// Pantalla de bienvenida
// ---------------------------------------------------------------------------

function WelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="text-xl font-semibold text-foreground">
        ¿En qué puedo ayudarte?
      </p>
      <p className="text-sm text-muted-foreground">
        Hacé una pregunta sobre tu documentación, pedí SEO o gestioná archivos
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mensaje de usuario
// ---------------------------------------------------------------------------

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full min-w-0 justify-end">
      <div className="max-w-[75%] min-w-0 rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts
          components={{ Text: UserTextPart }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserTextPart() {
  const { activeTenantId } = useWorkspace();
  const viewer = useViewer();

  const text = useAuiState((s) => {
    const msg = s.message as unknown as {
      readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
    };
    const content = msg.content ?? [];
    return [...content]
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  });

  const handleMentionClick = useCallback(
    async (name: string) => {
      if (!activeTenantId) return;
      try {
        const ctrl = new AbortController();
        const docs = await fetchDocumentSuggestions(activeTenantId, name, ctrl.signal);
        if (!docs.length) return;
        const doc = docs[0];
        const content = await fetchDocumentContent(activeTenantId, doc.id);
        viewer.openDocument(doc.id, content, doc.mime_type, doc.title);
      } catch {
        // si el doc no existe, silencioso
      }
    },
    [activeTenantId, viewer],
  );

  const parts = useMemo(() => {
    const result: Array<{ type: "text" | "mention"; value: string }> = [];
    const regex = /@(\S+)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: "text", value: text.slice(lastIndex, match.index) });
      }
      result.push({ type: "mention", value: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ type: "text", value: text.slice(lastIndex) });
    }
    return result;
  }, [text]);

  return (
    <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
      {parts.map((part, i) =>
        part.type === "mention" ? (
          <button
            key={i}
            type="button"
            title="Abrir archivo"
            onClick={() => handleMentionClick(part.value)}
            className="font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            @{part.value}
          </button>
        ) : (
          part.value
        ),
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Mensaje del asistente
// ---------------------------------------------------------------------------

function useMessageCustomSteps(): AgentRunStep[] | undefined {
  return useAuiState((s) => {
    const meta = s.message.metadata as { custom?: { steps?: AgentRunStep[] } } | undefined;
    const raw = meta?.custom?.steps;
    return Array.isArray(raw) && raw.length > 0 ? raw : undefined;
  });
}

function AssistantMessage() {
  const turnIndex = useAssistantTurnIndex();
  const stepsCtx = useOptionalAgentSteps();
  const metadataSteps = useMessageCustomSteps();
  const contextSteps = stepsCtx?.getStepsForTurn(turnIndex);
  const steps = metadataSteps ?? contextSteps;

  return (
    <MessagePrimitive.Root className="flex w-full min-w-0 justify-start gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
        AI
      </div>

      <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
        {steps && steps.length > 0 ? (
          <AgentStepsPanel steps={steps} defaultOpen={false} />
        ) : null}
        <div className="min-w-0 rounded-2xl rounded-tl-sm border bg-card px-4 py-3 shadow-sm">
          <MessagePrimitive.Parts
            components={{ Text: AssistantMarkdownTextPart }}
          />
          <MessagePrimitive.Error>
            <p className="mt-2 text-sm text-destructive">
              Error al generar la respuesta. Intentá de nuevo.
            </p>
          </MessagePrimitive.Error>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMarkdownTextPart() {
  // URLs largas y “palabras” sin espacios: min-w-0 en el flex + overflow-wrap y break-all en <a>.
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm dark:prose-invert max-w-none min-w-0 w-full [overflow-wrap:anywhere] [&_a]:break-all [&_li]:min-w-0 [&_p]:min-w-0 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:text-xs [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
    />
  );
}

// ---------------------------------------------------------------------------
// Compositor (input + @mention + botón enviar/cancelar)
// ---------------------------------------------------------------------------

type MentionState = { query: string; atStart: number };

function Composer() {
  const { addMention } = useMentions();
  const { activeTenantId } = useWorkspace();
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [suggestions, setSuggestions] = useState<DocOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Detectar @palabra antes del cursor
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const cursor = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, cursor);
      const match = before.match(/@(\w*)$/);
      if (match) {
        setMentionState({ query: match[1], atStart: before.lastIndexOf("@") });
      } else {
        setMentionState(null);
      }
    },
    [],
  );

  // Buscar docs cuando cambia la query
  useEffect(() => {
    if (mentionState === null || !activeTenantId) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    fetchDocumentSuggestions(activeTenantId, mentionState.query, ctrl.signal)
      .then(setSuggestions)
      .catch(() => {});
    return () => ctrl.abort();
  }, [mentionState, activeTenantId]);

  // Cerrar dropdown al click fuera
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMentionState(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const selectDoc = useCallback(
    (doc: DocOption) => {
      // Reemplazar @query con @titulo en el textarea
      const ta = containerRef.current?.querySelector("textarea");
      if (ta && mentionState !== null) {
        const { atStart, query } = mentionState;
        const value = ta.value;
        const replaceEnd = atStart + 1 + query.length;
        const newValue = value.slice(0, atStart) + "@" + doc.title + value.slice(replaceEnd);
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(ta, newValue);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        const newCursor = atStart + 1 + doc.title.length;
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(newCursor, newCursor);
        });
      }
      addMention({ id: doc.id, name: doc.title, type: "document" });
      setMentionState(null);
      setSuggestions([]);
    },
    [addMention, mentionState],
  );

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-background px-4 py-3">
      <div ref={containerRef} className="relative mx-auto max-w-3xl min-w-0 w-full">

        {/* Dropdown de sugerencias @mention */}
        {mentionState !== null && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full mb-1 w-full overflow-hidden rounded-xl border bg-popover shadow-md z-50"
          >
            {suggestions.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  selectDoc(doc);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent"
              >
                <FileText size={14} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input + botones */}
        <div className="flex items-end gap-2 rounded-2xl border bg-background px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <ComposerPrimitive.Input
            autoFocus
            placeholder="En qué puedo ayudarte"
            rows={1}
            onKeyUp={handleKeyUp}
            className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel asChild>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Cancelar"
              >
                <StopCircle size={16} />
              </button>
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send asChild>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="Enviar"
              >
                <ArrowUp size={16} />
              </button>
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
