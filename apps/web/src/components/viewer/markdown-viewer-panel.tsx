"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { useViewer } from "@/lib/contexts/viewer-context";
import { cn } from "@/lib/utils";

export function MarkdownViewerPanel() {
  const { content, mode, setContent, setMode } = useViewer();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-background">
      {/* Header con tabs */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "preview"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "edit"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Editar
          </button>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!content}
          aria-label="Copiar markdown"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!content ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-center text-sm text-muted-foreground">
              Las respuestas del asistente aparecerán acá
            </p>
          </div>
        ) : mode === "preview" ? (
          <div className="h-full overflow-y-auto px-4 py-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <textarea
            className="h-full w-full resize-none bg-muted/30 p-4 font-mono text-xs text-foreground outline-none"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
