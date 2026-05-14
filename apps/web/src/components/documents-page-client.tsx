"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow } from "@/lib/types/document";
import type { TenantOption } from "@/lib/types/tenant";

const STORAGE_KEY = "workyai_active_tenant_id";

const EDITOR_ROLES = new Set(["editor", "admin", "owner"]);

function indexStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pendiente de indexar";
    case "ready":
      return "Listo";
    case "failed":
      return "Falló la indexación";
    default:
      return status;
  }
}

export function DocumentsPageClient({ tenants }: { tenants: TenantOption[] }) {
  const [activeTenantId, setActiveTenantId] = useState("");
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const activeRole = useMemo(() => {
    const t = tenants.find((x) => x.tenantId === activeTenantId);
    return t?.role ?? "";
  }, [tenants, activeTenantId]);

  const canMutate = EDITOR_ROLES.has(activeRole);

  useEffect(() => {
    if (tenants.length === 0) {
      setActiveTenantId("");
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && tenants.some((t) => t.tenantId === stored)) {
      setActiveTenantId(stored);
      return;
    }
    setActiveTenantId(tenants[0].tenantId);
  }, [tenants]);

  const persistTenant = useCallback((id: string) => {
    setActiveTenantId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!activeTenantId) {
      setDocs([]);
      return;
    }
    setListError(null);
    setLoadingList(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, tenant_id, title, mime_type, size_bytes, index_status, index_error, created_at, updated_at",
      )
      .eq("tenant_id", activeTenantId)
      .order("updated_at", { ascending: false })
      .returns<DocumentRow[]>();

    if (error) {
      setListError(error.message);
      setDocs([]);
    } else {
      setDocs(data ?? []);
    }
    setLoadingList(false);
  }, [activeTenantId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  async function uploadDocument() {
    setUploadMsg(null);
    if (!canMutate) {
      setUploadMsg("Tu rol es solo lectura en este espacio.");
      return;
    }
    if (!activeTenantId) {
      setUploadMsg("Elegí un espacio activo.");
      return;
    }
    if (!title.trim()) {
      setUploadMsg("Completá el título.");
      return;
    }
    if (!file) {
      setUploadMsg("Seleccioná un archivo.");
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setUploadMsg("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }

    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setUploadMsg(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }

    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("file", file);

    setUploading(true);
    try {
      const res = await fetch(
        `${apiBase}/v1/tenants/${activeTenantId}/documents`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "X-Tenant-Id": activeTenantId,
          },
          body: fd,
        },
      );
      const body = (await res.json().catch(() => null)) as
        | (DocumentRow & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body && body.error
            ? String(body.error)
            : `HTTP ${res.status}`;
        setUploadMsg(msg);
        return;
      }
      if (
        body &&
        typeof body === "object" &&
        "index_status" in body &&
        body.index_status === "failed"
      ) {
        const detail =
          "index_error" in body && body.index_error
            ? String(body.index_error)
            : "Error desconocido";
        setUploadMsg(
          `El documento se creó pero la indexación falló: ${detail}`,
        );
      } else {
        setUploadMsg("Documento creado correctamente.");
      }
      setTitle("");
      setFile(null);
      await loadDocuments();
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : "Error de red");
    } finally {
      setUploading(false);
    }
  }

  async function downloadDocument(doc: DocumentRow) {
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setListError("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setListError(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }

    try {
      const res = await fetch(
        `${apiBase}/v1/tenants/${activeTenantId}/documents/${doc.id}/download`,
        {
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "X-Tenant-Id": activeTenantId,
          },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        const msg =
          body && typeof body === "object" && body.error
            ? String(body.error)
            : `HTTP ${res.status}`;
        setListError(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.title || "documento";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Error de red");
    }
  }

  async function deleteDocument(doc: DocumentRow) {
    if (!canMutate) {
      setListError("Tu rol es solo lectura en este espacio.");
      return;
    }
    if (
      !window.confirm(
        `¿Borrar el documento «${doc.title}»? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setListError("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setListError(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }

    try {
      const res = await fetch(
        `${apiBase}/v1/tenants/${activeTenantId}/documents/${doc.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "X-Tenant-Id": activeTenantId,
          },
        },
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        const msg =
          body && typeof body === "object" && body.error
            ? String(body.error)
            : `HTTP ${res.status}`;
        setListError(msg);
        return;
      }
      await loadDocuments();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Error de red");
    }
  }

  async function reindexDocument(doc: DocumentRow) {
    if (!canMutate) {
      setListError("Tu rol es solo lectura en este espacio.");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setListError("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setListError(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }

    try {
      const res = await fetch(
        `${apiBase}/v1/tenants/${activeTenantId}/documents/${doc.id}/reindex`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "X-Tenant-Id": activeTenantId,
            "Content-Type": "application/json",
          },
        },
      );
      const body = (await res.json().catch(() => null)) as
        | (DocumentRow & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        const msg =
          body && typeof body === "object" && "error" in body && body.error
            ? String(body.error)
            : `HTTP ${res.status}`;
        setListError(msg);
        return;
      }
      await loadDocuments();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Error de red");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <TenantSwitcher
        tenants={tenants}
        activeTenantId={activeTenantId}
        onSelect={persistTenant}
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Subir documento</h2>
        {!canMutate ? (
          <p className="text-sm text-muted-foreground">
            Tu rol en este espacio es de solo lectura. Pedí permisos de editor
            para subir o borrar archivos.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:max-w-md">
          <label className="text-xs text-muted-foreground" htmlFor="doc-title">
            Título
          </label>
          <Input
            id="doc-title"
            value={title}
            disabled={!canMutate}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej. Notas del proyecto"
          />
          <label className="text-xs text-muted-foreground" htmlFor="doc-file">
            Archivo (.md, .html, .txt, …)
          </label>
          <Input
            id="doc-file"
            type="file"
            disabled={!canMutate}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canMutate || uploading || !activeTenantId}
            onClick={() => void uploadDocument()}
          >
            {uploading ? "Subiendo…" : "Subir"}
          </Button>
        </div>
        {uploadMsg ? (
          <p
            className={`text-sm ${
              uploadMsg.includes("correctamente")
                ? "text-muted-foreground"
                : "text-destructive"
            }`}
            role="status"
          >
            {uploadMsg}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Documentos</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!activeTenantId || loadingList}
            onClick={() => void loadDocuments()}
          >
            {loadingList ? "Actualizando…" : "Actualizar lista"}
          </Button>
        </div>
        {listError ? (
          <p className="text-sm text-destructive" role="alert">
            {listError}
          </p>
        ) : null}
        {docs.length === 0 && !loadingList && !listError ? (
          <p className="text-sm text-muted-foreground">
            No hay documentos en este espacio todavía.
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {d.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.mime_type} · {(d.size_bytes / 1024).toFixed(1)} KiB
                </p>
                <p className="text-xs text-muted-foreground">
                  Estado de indexación:{" "}
                  <span className="font-medium text-foreground">
                    {indexStatusLabel(d.index_status)}
                  </span>
                </p>
                {d.index_error ? (
                  <p className="text-xs text-destructive">{d.index_error}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {d.index_status === "failed" && canMutate ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void reindexDocument(d)}
                  >
                    Reintentar indexación
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadDocument(d)}
                >
                  Descargar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!canMutate}
                  onClick={() => void deleteDocument(d)}
                >
                  Borrar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link
          href="/settings"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Configuración
        </Link>
        {" · "}
        <Link
          href="/dashboard"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
