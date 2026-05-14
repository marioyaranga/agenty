"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { InAppNotificationRow } from "@/lib/types/in-app-notification";

const TENANT_STORAGE_KEY = "workyai_active_tenant_id";

function metadataString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return typeof v === "string" ? v : "";
}

function notificationHref(row: InAppNotificationRow): string | null {
  const link = metadataString(row.metadata, "link");
  if (link === "documents") return "/documents";
  if (link === "chat") return "/chat";
  if (row.kind.startsWith("document")) return "/documents";
  if (row.kind.startsWith("agent")) return "/chat";
  return null;
}

export function InAppNotificationsHost({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotificationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(
    () => items.filter((r) => !r.read_at).length,
    [items],
  );

  const mergeRow = useCallback((row: InAppNotificationRow) => {
    setItems((prev) => {
      const without = prev.filter((x) => x.id !== row.id);
      return [row, ...without].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    });
  }, []);

  const fetchInitial = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("in_app_notifications")
      .select(
        "id, tenant_id, user_id, kind, title, body, metadata, read_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setLoadError(error.message);
      return;
    }
    setItems((data ?? []) as InAppNotificationRow[]);
  }, [userId]);

  useEffect(() => {
    void fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`in_app_notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "in_app_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as InAppNotificationRow | null;
          if (row?.id) mergeRow(row);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "in_app_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as InAppNotificationRow | null;
          if (row?.id) mergeRow(row);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, mergeRow]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(ev: MouseEvent) {
      const el = panelRef.current;
      if (!el?.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  async function markRead(id: string) {
    setBusyIds((s) => new Set(s).add(id));
    const supabase = createClient();
    const { data, error } = await supabase
      .from("in_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select(
        "id, tenant_id, user_id, kind, title, body, metadata, read_at, created_at",
      )
      .single();

    setBusyIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

    if (!error && data) mergeRow(data as InAppNotificationRow);
  }

  async function markAllRead() {
    const targets = items.filter((r) => !r.read_at).map((r) => r.id);
    if (targets.length === 0) return;
    setBusyIds((s) => new Set([...s, ...targets]));
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("in_app_notifications")
      .update({ read_at: now })
      .in("id", targets)
      .eq("user_id", userId);

    setBusyIds(new Set());
    if (error) {
      setLoadError(error.message);
      return;
    }
    setItems((prev) =>
      prev.map((r) =>
        targets.includes(r.id) ? { ...r, read_at: now } : r,
      ),
    );
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex justify-end md:right-6 md:top-6">
      <div className="pointer-events-auto relative" ref={panelRef}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="relative h-9 w-9 rounded-full border border-border bg-card p-0 text-card-foreground shadow-sm hover:bg-muted"
          aria-expanded={open}
          aria-label="Notificaciones"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>

        {open ? (
          <div
            className="absolute right-0 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
            role="dialog"
            aria-label="Lista de notificaciones"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Avisos</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                disabled={unreadCount === 0}
                onClick={() => void markAllRead()}
              >
                Marcar leídas
              </Button>
            </div>
            {loadError ? (
              <p className="px-3 py-2 text-xs text-destructive" role="alert">
                {loadError}
              </p>
            ) : null}
            <ul className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No hay notificaciones.
                </li>
              ) : (
                items.map((row) => {
                  const href = notificationHref(row);
                  const tenantId = metadataString(row.metadata, "tenant_id");
                  const isUnread = !row.read_at;
                  const inner = (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm ${isUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}
                        >
                          {row.title}
                        </p>
                        {isUnread ? (
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </div>
                      {row.body ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {row.body}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("es")}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {href ? (
                          <Link
                            href={href}
                            className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
                            onClick={() => {
                              if (tenantId) {
                                window.localStorage.setItem(
                                  TENANT_STORAGE_KEY,
                                  tenantId,
                                );
                              }
                              setOpen(false);
                            }}
                          >
                            {href === "/documents"
                              ? "Ir a documentos"
                              : "Ir al chat"}
                          </Link>
                        ) : null}
                        {isUnread ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                            disabled={busyIds.has(row.id)}
                            onClick={() => void markRead(row.id)}
                          >
                            Marcar leída
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );

                  return (
                    <li
                      key={row.id}
                      className="border-b border-border px-3 py-3 last:border-b-0"
                    >
                      {inner}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
