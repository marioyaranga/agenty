"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { AgentChatResponse, AgentCitation } from "@/lib/types/agent-chat";
import type { TenantOption } from "@/lib/types/tenant";

const STORAGE_KEY = "workyai_active_tenant_id";

export function ChatPageClient({ tenants }: { tenants: TenantOption[] }) {
  const [activeTenantId, setActiveTenantId] = useState("");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<AgentCitation[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (tenants.length === 0) {
      setActiveTenantId("");
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && tenants.some((t) => t.tenantId === stored)) {
      setActiveTenantId(stored);
      return;
    }
    setActiveTenantId(tenants[0].tenantId);
  }, [tenants]);

  const persistTenant = useCallback((id: string) => {
    setActiveTenantId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  async function sendMessage() {
    setError(null);
    setAnswer(null);
    setCitations([]);
    setRunId(null);
    setTraceId(null);

    if (!activeTenantId) {
      setError("Elegí un espacio activo.");
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Escribí un mensaje.");
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setError("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }

    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setError(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }

    setSending(true);
    try {
      const res = await fetch(
        `${apiBase}/v1/tenants/${activeTenantId}/agent/chat`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "X-Tenant-Id": activeTenantId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: trimmed }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | AgentChatResponse
        | { error?: string; detail?: string; run_id?: string }
        | null;
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body && body.error
            ? String(body.error)
            : `HTTP ${res.status}`;
        const detail =
          body && typeof body === "object" && "detail" in body && body.detail
            ? String(body.detail)
            : "";
        setError(detail ? `${msg}: ${detail}` : msg);
        if (body && typeof body === "object" && "run_id" in body && body.run_id) {
          setRunId(String(body.run_id));
        }
        return;
      }
      if (!body || typeof body !== "object" || !("answer" in body)) {
        setError("Respuesta inválida del servidor.");
        return;
      }
      const ok = body as AgentChatResponse;
      setAnswer(ok.answer);
      setCitations(Array.isArray(ok.citations) ? ok.citations : []);
      setRunId(ok.run_id ?? null);
      setTraceId(ok.langsmith_trace_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <TenantSwitcher
        tenants={tenants}
        activeTenantId={activeTenantId}
        onSelect={persistTenant}
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Pregunta</h2>
        <Input
          value={message}
          disabled={sending || !activeTenantId}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ej. ¿Qué dice la documentación sobre…?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={sending || !activeTenantId}
            onClick={() => void sendMessage()}
          >
            {sending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
            {runId ? (
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                run_id: {runId}
              </span>
            ) : null}
          </p>
        ) : null}
      </section>

      {answer ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">Respuesta</h2>
          <div className="whitespace-pre-wrap text-sm text-foreground">
            {answer}
          </div>
          {traceId ? (
            <p className="font-mono text-xs text-muted-foreground">
              LangSmith trace: {traceId}
            </p>
          ) : null}
        </section>
      ) : null}

      {citations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">
            Referencias (RAG)
          </h2>
          <ul className="flex flex-col gap-2">
            {citations.map((c, i) => (
              <li
                key={`${c.chunk_id}-${c.document_id}-${i}`}
                className="rounded-lg border border-border bg-card p-3 text-sm"
              >
                <p className="font-medium text-foreground">
                  {c.heading_path || "(sin ruta de encabezado)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  documento {c.document_id} · similitud{" "}
                  {c.similarity.toFixed(3)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <Link
          href="/documents"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Documentos
        </Link>
        {" · "}
        <Link
          href="/dashboard"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Panel
        </Link>
      </p>
    </div>
  );
}
