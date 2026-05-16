"use client";

/**
 * Lista de conversaciones del sidebar: selección, menú (renombrar / eliminar) y diálogo
 * de renombre vía `renameThreadById` (PATCH). El botón de fila solo selecciona; el menú
 * evita anidar acciones destructivas en el mismo clic que abrir el chat.
 */

import { useCallback, useState } from "react";
import { MessageSquare, MoreVertical, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChatThreads } from "@/lib/contexts/chat-thread-context";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ThreadItem } from "@/lib/assistant-ui/threads-api";

const TITLE_MAX = 200;

export function ChatHistoryPanel({
  onNewChat,
  onSelectThread,
}: {
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const {
    threads,
    activeThreadId,
    loading,
    loadingMore,
    hasMore,
    removeThread,
    loadMore,
    renameThreadById,
  } = useChatThreads();
  const router = useRouter();

  const [renameTarget, setRenameTarget] = useState<ThreadItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const openRename = useCallback((t: ThreadItem) => {
    setRenameDraft(t.title.slice(0, TITLE_MAX));
    setRenameError(null);
    setRenameTarget(t);
  }, []);

  const handleSelect = useCallback(
    (threadId: string) => {
      onSelectThread(threadId);
      router.push(`/chat/${threadId}`);
    },
    [onSelectThread, router],
  );

  const handleDelete = useCallback(
    async (threadId: string) => {
      const confirmed = window.confirm("¿Eliminar esta conversación?");
      if (!confirmed) return;
      const wasActive = activeThreadId === threadId;
      try {
        await removeThread(threadId);
        if (wasActive) router.push("/chat");
      } catch {
        /* silencioso */
      }
    },
    [removeThread, activeThreadId, router],
  );

  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null);
    setRenameSaving(false);
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async () => {
    if (!renameTarget) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError("El nombre no puede estar vacío.");
      return;
    }
    if (trimmed === renameTarget.title.trim()) {
      closeRenameDialog();
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      await renameThreadById(renameTarget.id, trimmed.slice(0, TITLE_MAX));
      closeRenameDialog();
    } catch {
      setRenameError("No se pudo guardar. Reintentá.");
    } finally {
      setRenameSaving(false);
    }
  }, [closeRenameDialog, renameDraft, renameTarget, renameThreadById]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-t px-2 py-1.5">
        <span className="text-xs font-semibold text-sidebar-foreground">
          Conversaciones
        </span>
        <button
          type="button"
          title="Nuevo chat"
          onClick={onNewChat}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={13} />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loading && threads.length === 0 ? (
          <div className="space-y-1 px-2 py-2">
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-4">
            <p className="text-center text-xs text-muted-foreground">
              Sin conversaciones previas
            </p>
          </div>
        ) : (
          <ul className="py-1">
            {threads.map((t) => (
              <li key={t.id} className="group/row">
                <div
                  className={cn(
                    "flex w-full items-center gap-0.5 px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent/60",
                    activeThreadId === t.id && "bg-accent font-medium",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(t.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MessageSquare
                      size={12}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none",
                            "opacity-70 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100",
                            "focus-visible:ring-2 focus-visible:ring-ring",
                            "group-hover/row:opacity-100",
                          )}
                          title="Más opciones"
                          aria-label={`Más opciones — ${t.title}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical size={14} />
                        </button>
                      }
                    />
                    <DropdownMenuContent align="end" side="bottom" className="min-w-40">
                      <DropdownMenuItem
                        onClick={() => {
                          openRename(t);
                        }}
                      >
                        Renombrar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void handleDelete(t.id)}
                      >
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
            {hasMore && (
              <li>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {loadingMore ? "Cargando…" : "Ver más"}
                </button>
              </li>
            )}
          </ul>
        )}
      </ScrollArea>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Renombrar conversación</DialogTitle>
            <DialogDescription>
              El nombre se muestra en el historial y en la cabecera del chat.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              value={renameDraft}
              maxLength={TITLE_MAX}
              disabled={renameSaving}
              aria-invalid={!!renameError}
              aria-label="Nuevo nombre"
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitRename();
                }
              }}
            />
            {renameError ? (
              <p className="text-xs text-destructive" role="alert">
                {renameError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={renameSaving}
              onClick={closeRenameDialog}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={renameSaving}
              onClick={() => void submitRename()}
            >
              {renameSaving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
