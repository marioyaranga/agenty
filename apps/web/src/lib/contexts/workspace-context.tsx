"use client";

import { createContext, useContext, useEffect, useState } from "react";

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

  useEffect(() => {
    const stored = window.localStorage.getItem(TENANT_STORAGE_KEY);
    const valid = tenants.find((t) => t.tenantId === stored);
    const initial = valid ? stored : (tenants[0]?.tenantId ?? null);
    setActiveTenantIdState(initial);
  }, [tenants]);

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
