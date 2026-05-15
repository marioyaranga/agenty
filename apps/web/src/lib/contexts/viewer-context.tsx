"use client";

import { createContext, useContext, useState } from "react";

type ViewerMode = "preview" | "edit";

type ViewerState = {
  content: string;
  mode: ViewerMode;
  setContent: (v: string) => void;
  setMode: (m: ViewerMode) => void;
};

const ViewerContext = createContext<ViewerState | null>(null);

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<ViewerMode>("preview");

  return (
    <ViewerContext value={{ content, mode, setContent, setMode }}>
      {children}
    </ViewerContext>
  );
}

export function useViewer(): ViewerState {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used inside ViewerProvider");
  return ctx;
}
