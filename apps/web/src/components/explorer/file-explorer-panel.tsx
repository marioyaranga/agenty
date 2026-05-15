"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";
import {
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  FolderPlus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useViewer } from "@/lib/contexts/viewer-context";
import {
  fetchTree,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  type FolderItem,
  type DocumentItem,
} from "@/lib/api/folders";
import {
  createDocument,
  renameDocument,
  moveDocument,
  fetchDocumentContent,
} from "@/lib/api/documents";
import { Dialog } from "@/components/ui/dialog";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";

// ---------------------------------------------------------------------------
// Tipo del nodo del árbol
// ---------------------------------------------------------------------------
type TreeNode = {
  id: string;
  name: string;
  type: "folder" | "document";
  mimeType?: string;
  children?: TreeNode[];
  data: FolderItem | DocumentItem;
};

function buildTree(
  folders: FolderItem[],
  documents: DocumentItem[],
): TreeNode[] {
  const folderMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const f of folders) {
    folderMap.set(f.id, {
      id: f.id,
      name: f.name,
      type: "folder",
      children: [],
      data: f,
    });
  }

  for (const f of folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_id && folderMap.has(f.parent_id)) {
      folderMap.get(f.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const doc of documents) {
    const docNode: TreeNode = {
      id: doc.id,
      name: doc.title,
      type: "document",
      mimeType: doc.mime_type,
      children: undefined,
      data: doc,
    };
    if (doc.folder_id && folderMap.has(doc.folder_id)) {
      folderMap.get(doc.folder_id)!.children!.push(docNode);
    } else {
      roots.push(docNode);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Contexto menu simple
// ---------------------------------------------------------------------------
type CtxMenu = {
  x: number;
  y: number;
  node: NodeApi<TreeNode>;
};

// ---------------------------------------------------------------------------
// Panel principal
// ---------------------------------------------------------------------------
export function FileExplorerPanel() {
  const { activeTenantId, setSelectedDocumentId } = useWorkspace();
  const { openDocument } = useViewer();
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);
  const [dialogInput, setDialogInput] = useState("");
  const [selectedNodeForCtx, setSelectedNodeForCtx] =
    useState<NodeApi<TreeNode> | null>(null);
  const [newItemParentId, setNewItemParentId] = useState<string | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);

  const loadTree = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await fetchTree(activeTenantId);
      setTreeData(buildTree(res.folders, res.documents));
    } catch {
      setTreeData([]);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Cerrar ctx menu al click fuera
  useEffect(() => {
    if (!ctxMenu) return;
    function onClickOutside() {
      setCtxMenu(null);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, [ctxMenu]);

  // Abrir archivo en el panel viewer
  const handleOpenDocument = useCallback(
    async (node: NodeApi<TreeNode>) => {
      if (!activeTenantId || node.data.type !== "document") return;
      setSelectedDocumentId(node.data.id);
      try {
        const text = await fetchDocumentContent(activeTenantId, node.data.id);
        const mime = node.data.mimeType ?? "text/markdown";
        openDocument(node.data.id, text, mime);
      } catch {
        openDocument(node.data.id, "", "text/markdown");
      }
    },
    [activeTenantId, openDocument, setSelectedDocumentId],
  );

  // Move handler (drag & drop)
  const handleMove = useCallback(
    async ({
      dragIds,
      parentId,
    }: {
      dragIds: string[];
      parentId: string | null;
    }) => {
      if (!activeTenantId) return;
      for (const id of dragIds) {
        const isFolder = treeData.some(function findFolder(n: TreeNode): boolean {
          if (n.id === id) return n.type === "folder";
          return (n.children ?? []).some(findFolder);
        });
        try {
          if (isFolder) {
            await moveFolder(activeTenantId, id, parentId);
          } else {
            await moveDocument(activeTenantId, id, parentId);
          }
        } catch {
          // Ignorar errores individuales, refrescar el árbol
        }
      }
      await loadTree();
    },
    [activeTenantId, loadTree, treeData],
  );

  // Rename inline handler
  const handleRename = useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      if (!activeTenantId) return;
      const isFolder = (function findFolder(nodes: TreeNode[]): boolean {
        for (const n of nodes) {
          if (n.id === id) return n.type === "folder";
          if ((n.children ?? []).length > 0) {
            const found = findFolder(n.children!);
            if (found !== undefined) return found;
          }
        }
        return false;
      })(treeData);
      try {
        if (isFolder) {
          await renameFolder(activeTenantId, id, name);
        } else {
          await renameDocument(activeTenantId, id, name);
        }
        await loadTree();
      } catch {
        await loadTree();
      }
    },
    [activeTenantId, loadTree, treeData],
  );

  // Crear carpeta
  async function handleCreateFolder() {
    if (!activeTenantId || !dialogInput.trim()) return;
    setSavingDoc(true);
    try {
      await createFolder(activeTenantId, dialogInput.trim(), newItemParentId);
      setNewFolderDialogOpen(false);
      setDialogInput("");
      setNewItemParentId(null);
      await loadTree();
    } catch {
      /* silencioso */
    } finally {
      setSavingDoc(false);
    }
  }

  // Crear documento
  async function handleCreateDocument() {
    if (!activeTenantId || !dialogInput.trim()) return;
    setSavingDoc(true);
    try {
      await createDocument(activeTenantId, {
        title: dialogInput.trim(),
        content: "",
        folder_id: newItemParentId,
        mime_type: "text/markdown",
      });
      setNewFileDialogOpen(false);
      setDialogInput("");
      setNewItemParentId(null);
      await loadTree();
    } catch {
      /* silencioso */
    } finally {
      setSavingDoc(false);
    }
  }

  // Eliminar item
  async function handleDeleteNode(node: NodeApi<TreeNode>) {
    if (!activeTenantId) return;
    const confirmed = window.confirm(
      `¿Eliminar "${node.data.name}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    try {
      if (node.data.type === "folder") {
        try {
          await deleteFolder(activeTenantId, node.data.id, false);
        } catch (e: unknown) {
          const err = e as { status?: number; childrenCount?: number };
          if (err.status === 409) {
            const forceConfirm = window.confirm(
              `La carpeta tiene ${err.childrenCount ?? ""} elementos. ¿Eliminar todo el contenido también?`,
            );
            if (forceConfirm) {
              await deleteFolder(activeTenantId, node.data.id, true);
            } else {
              return;
            }
          } else {
            throw e;
          }
        }
      }
    } catch {
      /* silencioso */
    }
    await loadTree();
  }

  if (!activeTenantId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-xs text-muted-foreground">
          Seleccioná un espacio de trabajo
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs font-semibold text-sidebar-foreground">
          Archivos
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            title="Nueva carpeta"
            onClick={() => {
              setNewItemParentId(null);
              setDialogInput("");
              setNewFolderDialogOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            title="Nuevo archivo"
            onClick={() => {
              setNewItemParentId(null);
              setDialogInput("");
              setNewFileDialogOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            title="Refrescar"
            onClick={loadTree}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Árbol */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && treeData.length === 0 ? (
          <div className="px-2 py-2 space-y-1">
            <SidebarMenuSkeleton showIcon />
            <SidebarMenuSkeleton showIcon />
            <SidebarMenuSkeleton showIcon />
          </div>
        ) : (
          <Tree<TreeNode>
            data={treeData}
            onMove={handleMove}
            onRename={handleRename}
            onActivate={handleOpenDocument}
            width="100%"
            indent={16}
            rowHeight={28}
            className="!overflow-visible"
          >
            {(props) => (
              <NodeRenderer
                {...props}
                onContextMenuRequest={(x, y, node) =>
                  setCtxMenu({ x, y, node })
                }
              />
            )}
          </Tree>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border bg-popover py-1 shadow-lg"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.node.data.type === "folder" && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setNewItemParentId(ctxMenu.node.data.id);
                  setDialogInput("");
                  setNewFolderDialogOpen(true);
                  setCtxMenu(null);
                }}
              >
                <FolderPlus size={12} /> Nueva subcarpeta
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setNewItemParentId(ctxMenu.node.data.id);
                  setDialogInput("");
                  setNewFileDialogOpen(true);
                  setCtxMenu(null);
                }}
              >
                <Plus size={12} /> Nuevo archivo aquí
              </button>
              <div className="my-1 border-t" />
            </>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              ctxMenu.node.edit();
              setCtxMenu(null);
            }}
          >
            Renombrar (F2)
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={() => {
              const node = ctxMenu.node;
              setCtxMenu(null);
              void handleDeleteNode(node);
            }}
          >
            Eliminar
          </button>
        </div>
      )}

      {/* Dialog: nueva carpeta */}
      <SimpleInputDialog
        open={newFolderDialogOpen}
        title="Nueva carpeta"
        placeholder="Nombre de la carpeta"
        value={dialogInput}
        onChange={setDialogInput}
        onConfirm={handleCreateFolder}
        onCancel={() => {
          setNewFolderDialogOpen(false);
          setDialogInput("");
        }}
        loading={savingDoc}
      />

      {/* Dialog: nuevo archivo */}
      <SimpleInputDialog
        open={newFileDialogOpen}
        title="Nuevo archivo"
        placeholder="Nombre del archivo (ej: notas.md)"
        value={dialogInput}
        onChange={setDialogInput}
        onConfirm={handleCreateDocument}
        onCancel={() => {
          setNewFileDialogOpen(false);
          setDialogInput("");
        }}
        loading={savingDoc}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renderizador de nodo
// ---------------------------------------------------------------------------
function NodeRenderer({
  node,
  style,
  dragHandle,
  onContextMenuRequest,
}: NodeRendererProps<TreeNode> & {
  onContextMenuRequest: (x: number, y: number, node: NodeApi<TreeNode>) => void;
}) {
  const isFolder = node.data.type === "folder";
  const Icon = isFolder
    ? node.isOpen
      ? FolderOpen
      : Folder
    : node.data.mimeType?.includes("html")
      ? FileText
      : File;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        "flex cursor-pointer select-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
        "text-sidebar-foreground hover:bg-accent/60",
        node.isSelected && "bg-accent font-medium",
      )}
      onClick={() => {
        if (isFolder) node.toggle();
        else node.activate();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenuRequest(e.clientX, e.clientY, node);
      }}
    >
      {isFolder && (
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            node.isOpen && "rotate-90",
          )}
        />
      )}
      {!isFolder && <span className="w-3" />}
      <Icon size={13} className="shrink-0 text-muted-foreground" />
      {node.isEditing ? (
        <input
          type="text"
          autoFocus
          defaultValue={node.data.name}
          className="min-w-0 flex-1 rounded border bg-background px-1 text-xs outline-none"
          onBlur={(e) => node.submit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") node.submit(e.currentTarget.value);
            if (e.key === "Escape") node.reset();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog simple de input
// ---------------------------------------------------------------------------
function SimpleInputDialog({
  open,
  title,
  placeholder,
  value,
  onChange,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded-xl border bg-background p-4 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        <input
          type="text"
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onConfirm();
            if (e.key === "Escape") onCancel();
          }}
          className="w-full rounded-lg border bg-muted/30 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={!value.trim() || loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading && <Loader2 size={11} className="animate-spin" />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}
