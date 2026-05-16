"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { bootstrapWorkspaceDefaults } from "@/lib/api/folders";
import type { TenantOption } from "@/lib/types/tenant";

export const TENANT_COOKIE_NAME = "workyai_active_tenant_id";
const TENANT_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function writeTenantCookie(id: string) {
  document.cookie = `${TENANT_COOKIE_NAME}=${encodeURIComponent(id)}; path=/; SameSite=Lax; Max-Age=${TENANT_COOKIE_MAX_AGE}`;
}

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
  initialTenantId,
}: {
  children: React.ReactNode;
  tenants: TenantOption[];
  initialTenantId?: string | null;
}) {
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(
    initialTenantId ?? null,
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [bootstrapTick, setBootstrapTick] = useState(0);

  const attemptedRef = useRef<Set<string>>(new Set());

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
    writeTenantCookie(id);
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
