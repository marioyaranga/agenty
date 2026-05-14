"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import {
  fetchTenantAuditPage,
  type AuditEventRow,
} from "@/lib/api/tenant-audit";
import { createClient } from "@/lib/supabase/client";
import type { TenantOption } from "@/lib/types/tenant";

const STORAGE_KEY = "workyai_active_tenant_id";
const ADMIN_ROLES = new Set(["owner", "admin"]);

export function AuditPageClient({ tenants }: { tenants: TenantOption[] }) {
  const [activeTenantId, setActiveTenantId] = useState("");
  const [items, setItems] = useState<AuditEventRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeRole = useMemo(() => {
    const t = tenants.find((x) => x.tenantId === activeTenantId);
    return t?.role ?? "";
  }, [tenants, activeTenantId]);

  const canView = ADMIN_ROLES.has(activeRole);

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

  const loadPage = useCallback(
    async (opts: { append: boolean; cursorVal: string | null }) => {
      setMessage(null);
      if (!activeTenantId) {
        return;
      }
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
      if (!apiBase) {
        setMessage("NEXT_PUBLIC_API_URL no está definida.");
        return;
      }
      const supabase = createClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        setMessage(
          sessionError?.message ??
            "No hay sesión con access_token. Iniciá sesión de nuevo.",
        );
        return;
      }
      setLoading(true);
      try {
        const data = await fetchTenantAuditPage(
          apiBase,
          sessionData.session.access_token,
          activeTenantId,
          {
            limit: 40,
            cursor: opts.cursorVal ?? undefined,
          },
        );
        setNextCursor(data.next_cursor);
        if (opts.append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Error al cargar auditoría.");
      } finally {
        setLoading(false);
      }
    },
    [activeTenantId],
  );

  useEffect(() => {
    if (!activeTenantId || !canView) {
      setItems([]);
      setNextCursor(null);
      return;
    }
    void loadPage({ append: false, cursorVal: null });
  }, [activeTenantId, canView, loadPage]);

  return (
    <div className="flex flex-col gap-6">
      <TenantSwitcher
        tenants={tenants}
        activeTenantId={activeTenantId}
        onSelect={persistTenant}
      />

      {!canView ? (
        <p className="text-sm text-muted-foreground">
          Solo usuarios con rol <span className="font-medium">owner</span> o{" "}
          <span className="font-medium">admin</span> pueden ver la auditoría de
          este espacio.
        </p>
      ) : null}

      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}

      {canView && items.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          No hay eventos registrados todavía para este espacio.
        </p>
      ) : null}

      {canView && items.length > 0 ? (
        <ul className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          {items.map((row) => (
            <li
              key={row.id}
              className="border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  {row.event_type}
                </span>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {JSON.stringify(row.payload, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      ) : null}

      {canView && nextCursor ? (
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => void loadPage({ append: true, cursorVal: nextCursor })}
        >
          {loading ? "Cargando…" : "Cargar más"}
        </Button>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Los eventos se registran desde el API (documentos, configuración de IA,
        chat del agente).{" "}
        <Link href="/dashboard" className="underline underline-offset-2">
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
