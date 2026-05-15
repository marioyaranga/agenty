"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useViewer } from "@/lib/contexts/viewer-context";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { CodeEditor } from "@/components/viewer/code-editor";
import { updateDocument } from "@/lib/api/documents";
import { cn } from "@/lib/utils";

export function MarkdownViewerPanel() {
  const {
    content,
    mode,
    openDocumentId,
    openDocumentMime,
    setContent,
    setMode,
    clearDocument,
  } = useViewer();
  const { activeTenantId } = useWorkspace();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const handleSave = useCallback(
    async (value: string) => {
      if (!activeTenantId || !openDocumentId) return;
      await updateDocument(activeTenantId, openDocumentId, { content: value });
    },
    [activeTenantId, openDocumentId],
  );

  const isHtml =
    openDocumentMime?.includes("html") || openDocumentMime?.includes("htm");

  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-background">
      {/* Header */}
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!content}
            aria-label="Copiar"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copiado" : "Copiar"}
          </button>
          {openDocumentId && (
            <button
              type="button"
              onClick={clearDocument}
              aria-label="Cerrar"
              title="Cerrar archivo"
              className="flex items-center rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!content && mode === "preview" ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-center text-sm text-muted-foreground">
              Las respuestas del asistente aparecerán acá
            </p>
          </div>
        ) : mode === "preview" ? (
          isHtml ? (
            <iframe
              srcDoc={content}
              sandbox="allow-same-origin"
              className="h-full w-full border-0"
              title="Preview HTML"
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </div>
            </div>
          )
        ) : (
          <CodeEditor
            value={content}
            mimeType={openDocumentMime}
            onChange={setContent}
            onSave={openDocumentId ? handleSave : undefined}
          />
        )}
      </div>
    </div>
  );
}
