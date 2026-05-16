"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useElementSize } from "@/lib/hooks/use-element-size";
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
  RefreshCw,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useViewer } from "@/lib/contexts/viewer-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
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
  uploadDocumentMultipart,
  DOCUMENT_UPLOAD_ACCEPT,
} from "@/lib/api/documents";

const EDITOR_ROLES = new Set(["editor", "admin", "owner"]);

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

/** MIME al crear desde el explorador: la API usa esto para Storage y RAG (solo indexa Markdown). */
function inferMimeTypeForNewDocument(title: string): string {
  const t = title.trim().toLowerCase();
  if (t.endsWith(".html") || t.endsWith(".htm")) return "text/html";
  if (t.endsWith(".txt") || t.endsWith(".text")) return "text/plain";
  return "text/markdown";
}

const KNOWN_DOC_FILE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdown",
  "mkd",
  "html",
  "htm",
  "txt",
  "text",
]);

/** El título ya parece traer extensión de archivo (no mostramos sufijo duplicado desde mime). */
function titleLooksLikeWithFileExtension(title: string): boolean {
  const t = title.trim();
  const i = t.lastIndexOf(".");
  if (i <= 0 || i === t.length - 1) return false;
  const ext = t.slice(i + 1).toLowerCase();
  if (KNOWN_DOC_FILE_EXTENSIONS.has(ext)) return true;
  // Sufijo tipo "json", "csv", etc.: corto, alfanumérico y con al menos una letra (evita "15.05.2026").
  if (
    ext.length >= 1 &&
    ext.length <= 12 &&
    /[a-z]/i.test(ext) &&
    /^[a-z0-9]+$/i.test(ext)
  ) {
    return true;
  }
  return false;
}

/** Extensión solo visual si el nombre guardado no la incluye (el `title` en DB no cambia). */
function displayOnlyExtensionFromMime(mimeType?: string): string {
  const base = (mimeType ?? "text/markdown").split(";")[0].trim().toLowerCase();
  if (base === "text/html") return ".html";
  if (base === "text/plain") return ".txt";
  if (base === "text/markdown" || base === "text/x-markdown") return ".md";
  return "";
}

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
  const {
    activeTenantId,
    selectedDocumentId,
    setSelectedDocumentId,
    bootstrapTick,
    tenants,
  } = useWorkspace();
  const { openDocument } = useViewer();
  const activeRole = useMemo(() => {
    if (!activeTenantId) return "";
    return tenants.find((t) => t.tenantId === activeTenantId)?.role ?? "";
  }, [tenants, activeTenantId]);
  const canMutate = EDITOR_ROLES.has(activeRole);

  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);
  const [dialogInput, setDialogInput] = useState("");
  const [newItemParentId, setNewItemParentId] = useState<string | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);
  const [uploadFolderLabel, setUploadFolderLabel] = useState<string | null>(
    null,
  );
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const {
    ref: treeViewportRef,
    width: treeWidth,
    height: treeHeight,
  } = useElementSize<HTMLDivElement>();

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
  }, [activeTenantId, bootstrapTick]);

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
      const title = node.data.name;
      try {
        const text = await fetchDocumentContent(activeTenantId, node.data.id);
        const mime = node.data.mimeType ?? "text/markdown";
        openDocument(node.data.id, text, mime, title);
      } catch {
        openDocument(node.data.id, "", "text/markdown", title);
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
    const title = dialogInput.trim();
    setSavingDoc(true);
    try {
      await createDocument(activeTenantId, {
        title,
        content: "",
        folder_id: newItemParentId,
        mime_type: inferMimeTypeForNewDocument(title),
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

  function openUploadDialog(folderId: string | null, folderLabel: string | null) {
    setUploadFolderId(folderId);
    setUploadFolderLabel(folderLabel);
    setUploadTitle("");
    setUploadFile(null);
    setUploadError(null);
    setUploadDialogOpen(true);
  }

  async function handleConfirmUpload() {
    if (!activeTenantId) return;
    if (!uploadTitle.trim() || !uploadFile) {
      setUploadError("Completá el título y elegí un archivo.");
      return;
    }
    const name = uploadFile.name.toLowerCase();
    const ok = [...KNOWN_DOC_FILE_EXTENSIONS].some((ext) =>
      name.endsWith(`.${ext}`),
    );
    if (!ok) {
      setUploadError("Extensión no permitida para subir.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      await uploadDocumentMultipart(activeTenantId, {
        title: uploadTitle.trim(),
        file: uploadFile,
        folder_id: uploadFolderId,
      });
      setUploadDialogOpen(false);
      setUploadTitle("");
      setUploadFile(null);
      setUploadFolderId(null);
      setUploadFolderLabel(null);
      await loadTree();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploading(false);
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
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <div className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1.5">
        <SidebarGroupLabel className="h-auto px-0 text-xs font-semibold text-sidebar-foreground opacity-100">
          Archivos
        </SidebarGroupLabel>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Nueva carpeta"
                  onClick={() => {
                    setNewItemParentId(null);
                    setDialogInput("");
                    setNewFolderDialogOpen(true);
                  }}
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Nueva carpeta</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Nuevo archivo"
                  onClick={() => {
                    setNewItemParentId(null);
                    setDialogInput("");
                    setNewFileDialogOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Nuevo archivo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Subir archivo"
                  disabled={!canMutate}
                  onClick={() => {
                    if (!canMutate) return;
                    openUploadDialog(null, null);
                  }}
                >
                  <Upload className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>
              {canMutate
                ? "Subir archivo desde tu equipo"
                : "Se requiere rol editor para subir"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refrescar"
                  onClick={() => void loadTree()}
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent>Refrescar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={treeViewportRef} className="min-h-0 flex-1 overflow-hidden">
          {loading && treeData.length === 0 ? (
            <SidebarMenu className="gap-1 px-2 py-2">
              <SidebarMenuSkeleton showIcon />
              <SidebarMenuSkeleton showIcon />
              <SidebarMenuSkeleton showIcon />
            </SidebarMenu>
          ) : treeData.length === 0 ? (
            <div className="flex items-center justify-center px-3 py-6">
              <p className="text-center text-xs text-muted-foreground">
                Sin archivos. Creá una carpeta o subí un documento.
              </p>
            </div>
          ) : treeWidth > 0 && treeHeight > 0 ? (
            <Tree<TreeNode>
              data={treeData}
              onMove={handleMove}
              onRename={handleRename}
              onActivate={handleOpenDocument}
              width={treeWidth}
              height={treeHeight}
              indent={12}
              rowHeight={28}
            >
              {(props) => (
                <NodeRenderer
                  {...props}
                  selectedDocumentId={selectedDocumentId}
                  onContextMenuRequest={(x, y, node) =>
                    setCtxMenu({ x, y, node })
                  }
                />
              )}
            </Tree>
          ) : null}
        </div>
      </SidebarGroupContent>

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
              {canMutate ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    openUploadDialog(
                      ctxMenu.node.data.id,
                      ctxMenu.node.data.name,
                    );
                    setCtxMenu(null);
                  }}
                >
                  <Upload size={12} /> Subir archivo aquí
                </button>
              ) : null}
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

      {/* Dialog: subir archivo */}
      <UploadDocumentDialog
        open={uploadDialogOpen}
        title={uploadTitle}
        onTitleChange={setUploadTitle}
        file={uploadFile}
        onFileChange={(f) => {
          setUploadFile(f);
          if (f && !uploadTitle.trim()) {
            setUploadTitle(f.name);
          }
        }}
        folderLabel={uploadFolderLabel}
        error={uploadError}
        uploading={uploading}
        onConfirm={() => void handleConfirmUpload()}
        onCancel={() => {
          setUploadDialogOpen(false);
          setUploadTitle("");
          setUploadFile(null);
          setUploadError(null);
          setUploadFolderId(null);
          setUploadFolderLabel(null);
        }}
      />

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
        placeholder="Nombre del archivo (ej: notas.md, página.html)"
        value={dialogInput}
        onChange={setDialogInput}
        onConfirm={handleCreateDocument}
        onCancel={() => {
          setNewFileDialogOpen(false);
          setDialogInput("");
        }}
        loading={savingDoc}
      />
    </SidebarGroup>
  );
}

// ---------------------------------------------------------------------------
// Renderizador de nodo
// ---------------------------------------------------------------------------
function NodeRenderer({
  node,
  style,
  dragHandle,
  selectedDocumentId,
  onContextMenuRequest,
}: NodeRendererProps<TreeNode> & {
  selectedDocumentId: string | null;
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

  const displayMimeExt =
    !isFolder &&
    !node.isEditing &&
    !titleLooksLikeWithFileExtension(node.data.name)
      ? displayOnlyExtensionFromMime(node.data.mimeType)
      : "";

  const isActive =
    node.isSelected ||
    (!isFolder && node.data.id === selectedDocumentId);

  return (
    <div
      ref={dragHandle}
      style={style}
      className="group/menu-item relative"
      data-sidebar="menu-item"
    >
      {node.isEditing ? (
        <div className="flex h-7 items-center px-2">
          <Input
            type="text"
            autoFocus
            defaultValue={node.data.name}
            className="h-6 text-xs"
            onBlur={(e) => node.submit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") node.submit(e.currentTarget.value);
              if (e.key === "Escape") node.reset();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <SidebarMenuButton
          size="sm"
          isActive={isActive}
          className="h-7 text-xs"
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
          {isFolder ? (
            <ChevronRight
              className={cn(
                "transition-transform",
                node.isOpen && "rotate-90",
              )}
            />
          ) : (
            <span className="size-4 shrink-0" aria-hidden />
          )}
          <Icon />
          <span className="flex min-w-0 flex-1 items-center gap-0 overflow-hidden">
            <span className="min-w-0 truncate">{node.data.name}</span>
            {displayMimeExt ? (
              <span className="shrink-0 text-muted-foreground">
                {displayMimeExt}
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog: subir archivo (multipart, misma API que /documents)
// ---------------------------------------------------------------------------
function UploadDocumentDialog({
  open,
  title,
  onTitleChange,
  file,
  onFileChange,
  folderLabel,
  error,
  uploading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  onTitleChange: (v: string) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  folderLabel: string | null;
  error: string | null;
  uploading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Subir archivo</DialogTitle>
          <DialogDescription>
            {folderLabel
              ? `Se guardará en la carpeta «${folderLabel}».`
              : "Se guardará en la raíz del explorador."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="upload-doc-title"
            >
              Título en la app
            </label>
            <Input
              id="upload-doc-title"
              autoFocus
              placeholder="Ej. Manual interno"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onConfirm();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="upload-doc-file"
            >
              Archivo
            </label>
            <Input
              id="upload-doc-file"
              type="file"
              accept={DOCUMENT_UPLOAD_ACCEPT}
              className="text-xs text-muted-foreground file:mr-2 file:text-xs"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!title.trim() || !file || uploading}
            onClick={() => void onConfirm()}
          >
            {uploading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Subiendo…
              </>
            ) : (
              "Subir"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onConfirm();
          }}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!value.trim() || loading}
            onClick={() => void onConfirm()}
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Creando…
              </>
            ) : (
              "Crear"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
