"use client";

import { useRef } from "react";
import { useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { createClient } from "@/lib/supabase/client";

type WorkyAiResponse = {
  run_id: string;
  thread_id: string;
  answer: string;
  citations: unknown[];
  langsmith_trace_id: string | null;
  langsmith_enabled: boolean;
};

export function useWorkyAiRuntime(tenantId: string) {
  const threadIdRef = useRef<string | null>(null);

  const adapter: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      const last = messages.at(-1);
      const userText =
        last?.content
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("\n") ?? "";

      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sin sesión activa. Iniciá sesión de nuevo.");

      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(
        /\/+$/,
        "",
      );

      const res = await fetch(
        `${apiBase}/v1/tenants/${tenantId}/agent/chat`,
        {
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
          }),
        },
      );

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body
            ? String(body.error)
            : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const ok = body as WorkyAiResponse;
      threadIdRef.current = ok.thread_id;

      return {
        content: [{ type: "text" as const, text: ok.answer }],
        metadata: {
          custom: {
            citations: ok.citations,
            run_id: ok.run_id,
            thread_id: ok.thread_id,
          },
        },
      };
    },
  };

  const runtime = useLocalRuntime(adapter);
  return { runtime, threadIdRef };
}
