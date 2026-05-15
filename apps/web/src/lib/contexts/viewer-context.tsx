"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { fetchDocumentContent } from "@/lib/api/documents";

export type TabMode = "preview" | "edit" | "split";

export type Tab = {
  id: string;
  title: string;
  mime: string;
  content: string;
  mode: TabMode;
  dirty: boolean;
  isLoading: boolean;
};

type PersistedTab = Pick<Tab, "id" | "title" | "mime" | "mode">;

type ViewerState = {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (opts: { id: string; title: string; content: string; mime?: string }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  setTabMode: (id: string, mode: TabMode) => void;
  markTabSaved: (id: string) => void;
  // back-compat con el explorador
  openDocument: (id: string, content: string, mime?: string, title?: string) => void;
};

const ViewerContext = createContext<ViewerState | null>(null);

function lsKey(tenantId: string) {
  return `viewer:tabs:${tenantId}`;
}

function saveLs(tenantId: string, tabs: Tab[], activeTabId: string | null) {
  const persisted: PersistedTab[] = tabs.map(({ id, title, mime, mode }) => ({
    id, title, mime, mode,
  }));
  try {
    localStorage.setItem(
      lsKey(tenantId),
      JSON.stringify({ tabs: persisted, activeTabId }),
    );
  } catch {
    /* quota error */
  }
}

function readLs(tenantId: string): { tabs: PersistedTab[]; activeTabId: string | null } | null {
  try {
    const raw = localStorage.getItem(lsKey(tenantId));
    if (!raw) return null;
    return JSON.parse(raw) as { tabs: PersistedTab[]; activeTabId: string | null };
  } catch {
    return null;
  }
}

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const { activeTenantId } = useWorkspace();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  // Guardar en localStorage cuando cambian tabs o activeTabId
  useEffect(() => {
    if (!activeTenantId) return;
    saveLs(activeTenantId, tabs, activeTabId);
  }, [activeTenantId, tabs, activeTabId]);

  // Restaurar tabs al cambiar de tenant
  useEffect(() => {
    if (!activeTenantId || activeTenantId === tenantRef.current) return;
    tenantRef.current = activeTenantId;

    const saved = readLs(activeTenantId);
    if (!saved || saved.tabs.length === 0) {
      setTabs([]);
      setActiveTabId(null);
      return;
    }

    const restored: Tab[] = saved.tabs.map((t) => ({
      ...t,
      content: "",
      dirty: false,
      isLoading: t.id === saved.activeTabId,
    }));
    setTabs(restored);
    setActiveTabId(saved.activeTabId);
  }, [activeTenantId]);

  // Fetch del contenido cuando activeTabId cambia y el tab no tiene contenido
  useEffect(() => {
    if (!activeTenantId || !activeTabId) return;
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab || tab.content !== "" || tab.isLoading) return;

    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t)),
    );
    fetchDocumentContent(activeTenantId, activeTabId)
      .then((text) => {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, content: text, isLoading: false } : t,
          ),
        );
      })
      .catch(() => {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, isLoading: false } : t,
          ),
        );
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTenantId]);

  const openTab = useCallback(
    ({ id, title, content, mime = "text/markdown" }: {
      id: string; title: string; content: string; mime?: string;
    }) => {
      setTabs((prev) => {
        if (prev.find((t) => t.id === id)) return prev;
        return [
          ...prev,
          { id, title, mime, content, mode: "preview", dirty: false, isLoading: false },
        ];
      });
      setActiveTabId(id);
    },
    [],
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTabId((prevActive) => {
      if (prevActive !== id) return prevActive;
      const current = tabsRef.current;
      const idx = current.findIndex((t) => t.id === id);
      const remaining = current.filter((t) => t.id !== id);
      if (remaining.length === 0) return null;
      return remaining[Math.min(idx, remaining.length - 1)].id;
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const updateTabContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
    );
  }, []);

  const setTabMode = useCallback((id: string, mode: TabMode) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, mode } : t)),
    );
  }, []);

  const markTabSaved = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dirty: false } : t)),
    );
  }, []);

  // back-compat: el explorador llama openDocument(id, content, mime, title)
  const openDocument = useCallback(
    (id: string, content: string, mime = "text/markdown", title = "Documento") => {
      setTabs((prev) => {
        const exists = prev.find((t) => t.id === id);
        if (exists) {
          // Actualizar contenido si ya existe (por si se recargó)
          return prev.map((t) => (t.id === id ? { ...t, content } : t));
        }
        return [
          ...prev,
          { id, title, mime, content, mode: "preview", dirty: false, isLoading: false },
        ];
      });
      setActiveTabId(id);
    },
    [],
  );

  return (
    <ViewerContext
      value={{
        tabs,
        activeTabId,
        openTab,
        closeTab,
        activateTab,
        updateTabContent,
        setTabMode,
        markTabSaved,
        openDocument,
      }}
    >
      {children}
    </ViewerContext>
  );
}

export function useViewer(): ViewerState {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used inside ViewerProvider");
  return ctx;
}
