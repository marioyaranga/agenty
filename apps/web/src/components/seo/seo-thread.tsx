"use client";

import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, StopCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSeoSteps } from "@/lib/contexts/seo-steps-context";
import { SeoSubagentsPanel } from "@/components/seo/seo-subagents-panel";

export function SeoThread({ className }: { className?: string }) {
  return (
    <ThreadPrimitive.Root
      className={cn("relative flex h-full flex-col overflow-hidden", className)}
    >
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
        <ThreadPrimitive.Empty>
          <SeoWelcomeScreen />
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage: SeoUserMessage,
            AssistantMessage: SeoAssistantMessage,
          }}
        />

        <SeoRunningSteps />

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

      <SeoComposer />
    </ThreadPrimitive.Root>
  );
}

function SeoWelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="text-xl font-semibold text-foreground">
        Consultas SEO con subagentes
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        El orquestador interpreta tu mensaje y delega en volumen de búsqueda y
        SERP vía DataForSEO. Verás cada paso antes de la respuesta.
      </p>
    </div>
  );
}

function SeoRunningSteps() {
  const { isRunning, activeSteps } = useSeoSteps();
  if (!isRunning || !activeSteps?.length) return null;

  return (
    <div className="flex w-full justify-start gap-3 pl-10">
      <SeoSubagentsPanel steps={activeSteps} defaultOpen />
    </div>
  );
}

function useAssistantTurnIndex(): number {
  return useAuiState((s) => {
    const messages = s.thread.messages;
    const idx = messages.findIndex((m) => m.id === s.message.id);
    if (idx < 0) return 0;
    return messages.slice(0, idx + 1).filter((m) => m.role === "assistant")
      .length - 1;
  });
}

function SeoUserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts components={{ Text: SeoUserTextPart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function SeoUserTextPart() {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      <MessagePartPrimitive.Text />
    </p>
  );
}

function SeoAssistantMessage() {
  const turnIndex = useAssistantTurnIndex();
  const { getStepsForTurn } = useSeoSteps();
  const steps = getStepsForTurn(turnIndex);

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
            components={{ Text: SeoAssistantMarkdownTextPart }}
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

function SeoAssistantMarkdownTextPart() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:text-xs"
    />
  );
}

function SeoComposer() {
  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-background px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <ComposerPrimitive.Input
          autoFocus
          placeholder="Ej.: volumen de marketing digital, SERP de agencia seo…"
          rows={1}
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
    </ComposerPrimitive.Root>
  );
}
