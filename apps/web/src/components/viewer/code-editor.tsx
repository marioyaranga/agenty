"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { languages } from "@codemirror/language-data";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { Check, Loader2 } from "lucide-react";
import { useIsDark } from "@/lib/hooks/use-is-dark";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  value: string;
  mimeType?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => Promise<void>;
  debounceMs?: number;
};

export function CodeEditor({
  value,
  mimeType = "text/markdown",
  onChange,
  onSave,
  debounceMs = 800,
}: Props) {
  const isDark = useIsDark();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(value);

  const isHtml =
    mimeType.includes("html") || mimeType.includes("htm");
  const extensions = isHtml
    ? [html()]
    : [markdown({ codeLanguages: languages })];

  const handleChange = useCallback(
    (val: string) => {
      latestValueRef.current = val;
      onChange?.(val);

      if (!onSave) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(() => {
        void onSave(val)
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("error"))
          .finally(() => {
            setTimeout(() => setSaveStatus("idle"), 1500);
          });
      }, debounceMs);
    },
    [onChange, onSave, debounceMs],
  );

  // Ctrl/Cmd+S guarda inmediatamente
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && onSave) {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSaveStatus("saving");
        void onSave(latestValueRef.current)
          .then(() => setSaveStatus("saved"))
          .catch(() => setSaveStatus("error"))
          .finally(() => {
            setTimeout(() => setSaveStatus("idle"), 1500);
          });
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Status indicator */}
      {saveStatus !== "idle" && (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md bg-background/80 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur">
          {saveStatus === "saving" && (
            <Loader2 size={11} className="animate-spin" />
          )}
          {saveStatus === "saved" && <Check size={11} className="text-green-500" />}
          <span>
            {saveStatus === "saving"
              ? "Guardando…"
              : saveStatus === "saved"
                ? "Guardado"
                : "Error al guardar"}
          </span>
        </div>
      )}

      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        height="100%"
        className="h-full overflow-hidden text-xs [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        theme={isDark ? githubDark : githubLight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
        }}
      />
    </div>
  );
}
