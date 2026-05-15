"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { bootstrapWorkspaceDefaults } from "@/lib/api/folders";
import type { TenantOption } from "@/lib/types/tenant";

const TENANT_STORAGE_KEY = "workyai_active_tenant_id";

type WorkspaceState = {
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string) => void;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (id: string | null) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  bootstrapTick: number;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({
  children,
  tenants,
}: {
  children: React.ReactNode;
  tenants: TenantOption[];
}) {
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [bootstrapTick, setBootstrapTick] = useState(0);

  // Tenants ya intentados en esta sesión para no repetir el request.
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const stored = window.localStorage.getItem(TENANT_STORAGE_KEY);
    const valid = tenants.find((t) => t.tenantId === stored);
    const initial = valid ? stored : (tenants[0]?.tenantId ?? null);
    setActiveTenantIdState(initial);
  }, [tenants]);

  // Seeding fire-and-forget cuando se activa un tenant nuevo en esta sesión.
  useEffect(() => {
    if (!activeTenantId) return;
    if (attemptedRef.current.has(activeTenantId)) return;
    attemptedRef.current.add(activeTenantId);

    bootstrapWorkspaceDefaults(activeTenantId)
      .then((result) => {
        if (result.status === "seeded") {
          setBootstrapTick((t) => t + 1);
        }
      })
      .catch(() => {
        // Fallo silencioso: el workspace queda vacío y el usuario puede crear contenido manualmente.
        // En el próximo reload se reintenta porque defaults_seeded_at sigue NULL.
      });
  }, [activeTenantId]);

  function setActiveTenantId(id: string) {
    window.localStorage.setItem(TENANT_STORAGE_KEY, id);
    setActiveTenantIdState(id);
  }

  return (
    <WorkspaceContext
      value={{
        tenants,
        activeTenantId,
        setActiveTenantId,
        selectedDocumentId,
        setSelectedDocumentId,
        rightPanelOpen,
        setRightPanelOpen,
        bootstrapTick,
      }}
    >
      {children}
    </WorkspaceContext>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
