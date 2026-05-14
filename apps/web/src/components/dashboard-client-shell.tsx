"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

import { TenantSwitcher } from "@/components/tenant-switcher";
import type { TenantOption } from "@/lib/types/tenant";

const STORAGE_KEY = "workyai_active_tenant_id";

type MeResponse = Record<string, unknown>;

export function DashboardClientShell({ tenants }: { tenants: TenantOption[] }) {
  const [activeTenantId, setActiveTenantId] = useState("");
  const [meJson, setMeJson] = useState<string | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function callMe() {
    setMeError(null);
    setMeJson(null);
    setLoading(true);
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setMeError("NEXT_PUBLIC_API_URL no está definida.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      setMeError(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      setLoading(false);
      return;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    };
    if (activeTenantId) {
      headers["X-Tenant-Id"] = activeTenantId;
    }

    try {
      const res = await fetch(`${apiBase}/v1/me`, {
        headers,
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as MeResponse | null;
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as { error?: unknown }).error)
            : `HTTP ${res.status}`;
        setMeError(msg);
        setLoading(false);
        return;
      }
      setMeJson(JSON.stringify(body, null, 2));
    } catch (e) {
      setMeError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <TenantSwitcher
        tenants={tenants}
        activeTenantId={activeTenantId}
        onSelect={persistTenant}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            Prueba con el API (Bearer + X-Tenant-Id)
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/settings"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Configuración
            </Link>
            <Button
              type="button"
              size="sm"
              disabled={loading || !activeTenantId}
              onClick={() => void callMe()}
            >
              {loading ? "Consultando…" : "GET /v1/me"}
            </Button>
          </div>
        </div>
        {meError ? (
          <p className="text-sm text-destructive" role="alert">
            {meError}
          </p>
        ) : null}
        {meJson ? (
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {meJson}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
