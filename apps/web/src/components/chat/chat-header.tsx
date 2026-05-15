"use client";

/**
 * Cabecera del panel de chat: título del hilo (lista o `threadTitleHint` del GET al hidratar).
 * Renombre: botón lápiz (accesible), doble clic en el título, o Enter/Escape/blur en el input
 * → `renameActiveThread` (PATCH /agent/threads/:id).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Plus } from "lucide-react";
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
          <div className="group/title flex min-w-0 max-w-[min(100%,320px)] items-center gap-1">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-muted-foreground select-none",
                saving && "opacity-50",
              )}
              title="Doble clic para editar el nombre"
              onDoubleClick={() => {
                if (!saving) startEditing();
              }}
            >
              {displayTitle}
            </span>
            <button
              type="button"
              title="Editar nombre"
              disabled={saving}
              aria-label="Editar nombre de la conversación"
              onClick={(e) => {
                e.preventDefault();
                startEditing();
              }}
              className={cn(
                "shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors",
                "opacity-60 hover:bg-accent hover:text-foreground hover:opacity-100",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "group-hover/title:opacity-100",
                saving && "pointer-events-none opacity-40",
              )}
            >
              <Pencil size={14} aria-hidden />
            </button>
          </div>
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
