"use client";

import { createContext, useContext, useState } from "react";

type ViewerMode = "preview" | "edit";

type ViewerState = {
  content: string;
  mode: ViewerMode;
  openDocumentId: string | null;
  openDocumentMime: string;
  setContent: (v: string) => void;
  setMode: (m: ViewerMode) => void;
  openDocument: (id: string, content: string, mime?: string) => void;
  clearDocument: () => void;
};

const ViewerContext = createContext<ViewerState | null>(null);

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<ViewerMode>("preview");
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [openDocumentMime, setOpenDocumentMime] = useState("text/markdown");

  function openDocument(id: string, docContent: string, mime = "text/markdown") {
    setOpenDocumentId(id);
    setOpenDocumentMime(mime);
    setContent(docContent);
    setMode("preview");
  }

  function clearDocument() {
    setOpenDocumentId(null);
    setContent("");
    setMode("preview");
  }

  return (
    <ViewerContext
      value={{
        content,
        mode,
        openDocumentId,
        openDocumentMime,
        setContent,
        setMode,
        openDocument,
        clearDocument,
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
