"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { Copy, Check, X, Loader2 } from "lucide-react";
import { useCallback, useDeferredValue, useState } from "react";
import { useViewer } from "@/lib/contexts/viewer-context";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { CodeEditor } from "@/components/viewer/code-editor";
import { CodeBlock } from "@/components/viewer/code-block";
import { ViewerTabsBar } from "@/components/viewer/viewer-tabs-bar";
import { OutlinePanel } from "@/components/viewer/outline-panel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { updateDocument } from "@/lib/api/documents";
import { cn } from "@/lib/utils";

export function MarkdownViewerPanel() {
  const {
    tabs,
    activeTabId,
    activateTab,
    closeTab,
    updateTabContent,
    setTabMode,
    markTabSaved,
  } = useViewer();
  const { activeTenantId } = useWorkspace();
  const [copied, setCopied] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isHtml =
    activeTab?.mime?.includes("html") || activeTab?.mime?.includes("htm");

  // Preview usa un valor diferido para no re-renderizar shiki en cada tecla en modo split
  const deferredContent = useDeferredValue(activeTab?.content ?? "");

  const handleCopy = useCallback(() => {
    if (!activeTab?.content) return;
    void navigator.clipboard.writeText(activeTab.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [activeTab?.content]);

  const handleSave = useCallback(
    async (value: string) => {
      if (!activeTenantId || !activeTabId) return;
      await updateDocument(activeTenantId, activeTabId, { content: value });
      markTabSaved(activeTabId);
    },
    [activeTenantId, activeTabId, markTabSaved],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      if (activeTabId) updateTabContent(activeTabId, value);
    },
    [activeTabId, updateTabContent],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-background">
      {/* Barra de tabs */}
      <ViewerTabsBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
      />

      {/* Header de controles */}
      {activeTab && (
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
          {/* Tabs de modo */}
          <div className="flex gap-1">
            {(["preview", "edit", "split"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTabMode(activeTab.id, m)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
                  activeTab.mode === m
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "preview" ? "Vista" : m === "edit" ? "Editar" : "Split"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!activeTab.content}
              aria-label="Copiar"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab.dirty) {
                  if (!window.confirm(`¿Cerrar "${activeTab.title}" con cambios sin guardar?`)) return;
                }
                closeTab(activeTab.id);
              }}
              aria-label="Cerrar"
              title="Cerrar archivo"
              className="flex items-center rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!activeTab ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-center text-sm text-muted-foreground">
              Seleccioná un archivo del explorador para visualizarlo o editarlo
            </p>
          </div>
        ) : activeTab.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : activeTab.mode === "split" ? (
          <SplitView
            activeTab={activeTab}
            isHtml={isHtml ?? false}
            deferredContent={deferredContent}
            onEditorChange={handleEditorChange}
            onSave={handleSave}
          />
        ) : activeTab.mode === "edit" ? (
          <CodeEditor
            value={activeTab.content}
            mimeType={activeTab.mime}
            onChange={handleEditorChange}
            onSave={handleSave}
          />
        ) : isHtml ? (
          <iframe
            srcDoc={activeTab.content}
            sandbox=""
            className="h-full w-full border-0"
            title="Preview HTML"
          />
        ) : (
          <MarkdownPreviewWithOutline content={deferredContent} />
        )}
      </div>
    </div>
  );
}

// Schema de sanitize que permite id en headings (para anclas del outline)
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    h1: [...(defaultSchema.attributes?.h1 ?? []), "id"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "id"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "id"],
    h4: [...(defaultSchema.attributes?.h4 ?? []), "id"],
    h5: [...(defaultSchema.attributes?.h5 ?? []), "id"],
    h6: [...(defaultSchema.attributes?.h6 ?? []), "id"],
  },
};

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug, [rehypeSanitize, sanitizeSchema]]}
          components={{
            pre: CodeBlock,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function MarkdownPreviewWithOutline({ content }: { content: string }) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="min-w-0 flex-1 overflow-hidden">
        <MarkdownPreview content={content} />
      </div>
      <OutlinePanel content={content} />
    </div>
  );
}

function SplitView({
  activeTab,
  isHtml,
  deferredContent,
  onEditorChange,
  onSave,
}: {
  activeTab: { id: string; content: string; mime: string };
  isHtml: boolean;
  deferredContent: string;
  onEditorChange: (v: string) => void;
  onSave: (v: string) => Promise<void>;
}) {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel minSize={20} defaultSize={50}>
        <CodeEditor
          value={activeTab.content}
          mimeType={activeTab.mime}
          onChange={onEditorChange}
          onSave={onSave}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={20} defaultSize={50}>
        {isHtml ? (
          <iframe
            srcDoc={deferredContent}
            sandbox=""
            className="h-full w-full border-0"
            title="Preview HTML"
          />
        ) : (
          <MarkdownPreview content={deferredContent} />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
