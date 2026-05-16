"use client";

import { useRef, type MutableRefObject } from "react";
import { useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { createClient } from "@/lib/supabase/client";
import type { AgentRunStep } from "@/lib/types/agent-steps";
import type { Mention } from "@/lib/contexts/mentions-context";

type AgentSseEvent =
  | { type: "started"; run_id: string; thread_id: string }
  | { type: "step"; node: string; label: string; description: string; status: "running" | "done" }
  | {
      type: "tool";
      tool_name: string;
      label: string;
      description: string;
      status: "running" | "done";
      ok?: boolean;
      detail?: string | null;
    }
  | {
      type: "done";
      run_id: string;
      thread_id: string;
      answer: string;
      citations: unknown[];
      web_sources?: Array<{ uri: string; title: string }>;
      steps: AgentRunStep[];
      langsmith_trace_id: string | null;
      langsmith_enabled: boolean;
    }
  | { type: "error"; detail: string; run_id?: string; thread_id?: string };

export type AgentRuntimeCallbacks = {
  onRunStart: () => void;
  onRunComplete: (turnIndex: number, steps: AgentRunStep[]) => void;
  onRunEnd: () => void;
  onThreadUpdate?: (threadId: string) => void;
  onStepProgress?: (node: string, label: string, description: string, status: "running" | "done") => void;
  onToolProgress?: (
    toolName: string,
    label: string,
    description: string,
    status: "running" | "done",
    ok?: boolean,
    detail?: string | null,
  ) => void;
};

export function useWorkyAiRuntime(
  tenantId: string,
  callbacks?: AgentRuntimeCallbacks,
  initialMessages?: readonly ThreadMessageLike[],
  initialThreadId?: string | null,
  mentionsRef?: MutableRefObject<Mention[]>,
) {
  const threadIdRef = useRef<string | null>(initialThreadId ?? null);

  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }) {
      const last = messages.at(-1);
      const userText =
        last?.content
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("\n") ?? "";

      const turnIndex = messages.filter((m) => m.role === "assistant").length;

      callbacks?.onRunStart();

      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sin sesión activa. Iniciá sesión de nuevo.");

      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

      try {
        let res: Response;
        try {
          res = await fetch(`${apiBase}/v1/tenants/${tenantId}/agent/chat`, {
            method: "POST",
            signal: abortSignal,
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Tenant-Id": tenantId,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: userText,
              thread_id: threadIdRef.current,
              mentions: (mentionsRef?.current ?? []).map((m) => ({
                id: m.id,
                name: m.name,
                type: m.type,
              })),
            }),
          });
        } catch (fetchErr) {
          const hint =
            fetchErr instanceof TypeError &&
            String(fetchErr.message).toLowerCase().includes("fetch")
              ? " La API puede haber tardado demasiado. Reintentá en unos segundos."
              : "";
          throw new Error(
            `${fetchErr instanceof Error ? fetchErr.message : "Error de red"}${hint}`,
          );
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const errObj =
            body && typeof body === "object" ? (body as Record<string, unknown>) : null;
          const detail =
            errObj && typeof errObj.detail === "string" ? errObj.detail : "";
          const base =
            errObj && typeof errObj.error === "string"
              ? String(errObj.error)
              : `HTTP ${res.status}`;
          throw new Error(detail ? `${base} (${detail})` : base);
        }

        if (!res.body) throw new Error("La respuesta no tiene cuerpo.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (abortSignal.aborted) { reader.cancel(); break; }

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data: ")) continue;
              let event: AgentSseEvent;
              try {
                event = JSON.parse(line.slice(6)) as AgentSseEvent;
              } catch {
                continue;
              }

              if (event.type === "started") {
                threadIdRef.current = event.thread_id;
                callbacks?.onThreadUpdate?.(event.thread_id);
              } else if (event.type === "step") {
                callbacks?.onStepProgress?.(event.node, event.label, event.description, event.status);
              } else if (event.type === "tool") {
                callbacks?.onToolProgress?.(
                  event.tool_name,
                  event.label,
                  event.description,
                  event.status,
                  event.ok,
                  event.detail,
                );
              } else if (event.type === "done") {
                threadIdRef.current = event.thread_id;
                callbacks?.onThreadUpdate?.(event.thread_id);
                if (mentionsRef) mentionsRef.current = [];
                const steps = Array.isArray(event.steps) ? event.steps : [];
                const webSources = Array.isArray(event.web_sources) ? event.web_sources : [];
                callbacks?.onRunComplete(turnIndex, steps);
                yield {
                  content: [{ type: "text" as const, text: event.answer }],
                  metadata: {
                    custom: {
                      citations: event.citations,
                      web_sources: webSources,
                      run_id: event.run_id,
                      thread_id: event.thread_id,
                      steps,
                    },
                  },
                };
              } else if (event.type === "error") {
                throw new Error(event.detail || "Error del agente");
              }
            }
          }
        } finally {
          reader.releaseLock?.();
        }
      } finally {
        callbacks?.onRunEnd();
      }
    },
  };

  const runtime = useLocalRuntime(adapter, { initialMessages });
  return { runtime, threadIdRef };
}
