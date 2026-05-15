"use client";

/**
 * Cabecera del panel de chat: muestra el título del hilo activo (lista en contexto o
 * `threadTitleHint` desde GET /threads/:id al hidratar) y permite renombrarlo con
 * `renameActiveThread` → PATCH /agent/threads/:id (título no vacío, máx. 200).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TITLE_MAX = 200;

type Props = {
  activeThreadId: string | null;
  /** Título del GET del thread (útil si el hilo aún no está en la primera página de la lista). */
  threadTitleHint?: string | null;
  onNewChat: () => void;
};

export function ChatHeader({ activeThreadId, threadTitleHint, onNewChat }: Props) {
  const { threads, renameActiveThread } = useChatThreads();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fromList = activeThreadId
    ? threads.find((t) => t.id === activeThreadId)?.title
    : undefined;
  const displayTitle =
    fromList?.trim() ||
    threadTitleHint?.trim() ||
    (activeThreadId ? "Conversación" : "");

  const startEditing = useCallback(() => {
    if (!activeThreadId || saving) return;
    setDraft(displayTitle.slice(0, TITLE_MAX));
    setError(null);
    setEditing(true);
  }, [activeThreadId, displayTitle, saving]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setDraft("");
    setError(null);
  }, []);

  const commit = useCallback(async () => {
    if (!activeThreadId) {
      cancelEditing();
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("El nombre no puede estar vacío.");
      queueMicrotask(() => inputRef.current?.focus());
      return;
    }
    if (trimmed === displayTitle) {
      cancelEditing();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await renameActiveThread(trimmed.slice(0, TITLE_MAX));
      cancelEditing();
    } catch {
      setError("No se pudo guardar. Reintentá.");
      queueMicrotask(() => inputRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }, [activeThreadId, cancelEditing, displayTitle, draft, renameActiveThread]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  return (
    <div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground">
        <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
        {!activeThreadId ? (
          <span className="max-w-[280px] truncate text-sm text-muted-foreground">
            Nueva conversación
          </span>
        ) : editing ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              ref={inputRef}
              value={draft}
              maxLength={TITLE_MAX}
              disabled={saving}
              aria-invalid={!!error}
              aria-label="Nombre de la conversación"
              className="h-8 max-w-[min(100%,320px)] text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditing();
                }
              }}
            />
            {error ? (
              <span className="text-xs text-destructive" role="alert">
                {error}
              </span>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            title="Clic para editar el nombre"
            disabled={saving}
            onClick={startEditing}
            className={cn(
              "max-w-[min(100%,280px)] truncate text-left text-sm text-muted-foreground transition-colors",
              "rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              saving && "pointer-events-none opacity-50",
            )}
          >
            {displayTitle}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Nuevo chat"
      >
        <Plus size={14} />
        Nuevo
      </button>
    </div>
  );
}
