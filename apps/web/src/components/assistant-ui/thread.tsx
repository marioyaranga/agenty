"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, StopCircle, ChevronDown, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOptionalSeoSteps } from "@/lib/contexts/seo-steps-context";
import { SeoSubagentsPanel } from "@/components/seo/seo-subagents-panel";
import { useMentions, type Mention } from "@/lib/contexts/mentions-context";
import { useWorkspace } from "@/lib/contexts/workspace-context";
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
      className={cn("relative flex h-full flex-col overflow-hidden", className)}
    >
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
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
      </ThreadPrimitive.Viewport>

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
  const steps = useOptionalSeoSteps();
  if (!steps?.isRunning || !steps.activeSteps?.length) return null;

  return (
    <div className="flex w-full justify-start gap-3 pl-10">
      <SeoSubagentsPanel steps={steps.activeSteps} defaultOpen />
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
    <MessagePrimitive.Root className="flex w-full justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts
          components={{ Text: UserTextPart }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserTextPart() {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      <MessagePartPrimitive.Text />
    </p>
  );
}

// ---------------------------------------------------------------------------
// Mensaje del asistente
// ---------------------------------------------------------------------------

function AssistantMessage() {
  const turnIndex = useAssistantTurnIndex();
  const stepsCtx = useOptionalSeoSteps();
  const steps = stepsCtx?.getStepsForTurn(turnIndex);

  return (
    <MessagePrimitive.Root className="flex w-full justify-start gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
        AI
      </div>

      <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
        {steps && steps.length > 0 ? (
          <SeoSubagentsPanel steps={steps} defaultOpen={false} />
        ) : null}
        <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 shadow-sm">
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
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:text-xs"
    />
  );
}

// ---------------------------------------------------------------------------
// Compositor (input + @mention + botón enviar/cancelar)
// ---------------------------------------------------------------------------

function Composer() {
  const { mentions, addMention, removeMention } = useMentions();
  const { activeTenantId } = useWorkspace();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DocOption[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Detectar @palabra antes del cursor
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
      const match = before.match(/@(\w*)$/);
      setMentionQuery(match ? match[1] : null);
    },
    [],
  );

  // Buscar docs cuando cambia mentionQuery
  useEffect(() => {
    if (mentionQuery === null || !activeTenantId) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    fetchDocumentSuggestions(activeTenantId, mentionQuery, ctrl.signal)
      .then(setSuggestions)
      .catch(() => {});
    return () => ctrl.abort();
  }, [mentionQuery, activeTenantId]);

  // Cerrar dropdown al click fuera
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const selectDoc = useCallback(
    (doc: DocOption) => {
      addMention({ id: doc.id, name: doc.title, type: "document" });
      setMentionQuery(null);
      setSuggestions([]);
    },
    [addMention],
  );

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-background px-4 py-3">
      <div className="relative mx-auto max-w-3xl">

        {/* Dropdown de sugerencias @mention */}
        {mentionQuery !== null && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full mb-1 w-full rounded-xl border bg-popover shadow-md z-50 overflow-hidden"
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

        {/* Chips de mentions seleccionados */}
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {mentions.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                <FileText size={10} />
                {m.name}
                <button
                  type="button"
                  aria-label={`Quitar @${m.name}`}
                  onClick={() => removeMention(m.id)}
                  className="ml-0.5 rounded-full hover:text-destructive"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input + botones */}
        <div className="flex items-end gap-2 rounded-2xl border bg-background px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <ComposerPrimitive.Input
            autoFocus
            placeholder="Preguntá sobre tus docs, escribí @nombre para adjuntar un archivo…"
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
