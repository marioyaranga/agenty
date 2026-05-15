import { createClient } from "@/lib/supabase/client";

async function getHeaders(tenantId: string): Promise<HeadersInit> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": tenantId,
    "Content-Type": "application/json",
  };
}

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
}

export type DocumentDetail = {
  id: string;
  folder_id: string | null;
  title: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  index_status: "pending" | "ready" | "failed";
  index_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchDocumentContent(
  tenantId: string,
  documentId: string,
): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/documents/${documentId}/download`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Id": tenantId,
      },
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Extensiones permitidas por la API en ``POST .../documents`` (multipart). */
export const DOCUMENT_UPLOAD_ACCEPT =
  ".md,.markdown,.mdown,.mkd,.html,.htm,.txt,.text";

/** Sube bytes desde el navegador (multipart: ``title``, ``file``, ``folder_id`` opcional). */
export async function uploadDocumentMultipart(
  tenantId: string,
  opts: { title: string; file: File; folder_id?: string | null },
): Promise<DocumentDetail> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const fd = new FormData();
  fd.append("title", opts.title.trim());
  fd.append("file", opts.file);
  if (opts.folder_id) {
    fd.append("folder_id", opts.folder_id);
  }
  const res = await fetch(`${apiBase()}/v1/tenants/${tenantId}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId,
    },
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<DocumentDetail>;
}

/** Crea un documento en Storage + fila `documents`. `mime_type` rige el Content-Type (p. ej. `text/html`, `text/markdown`); el explorador lo infiere del título (.html → HTML). */
export async function createDocument(
  tenantId: string,
  opts: {
    title: string;
    content?: string;
    folder_id?: string | null;
    mime_type?: string;
  },
): Promise<DocumentDetail> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/documents/create`,
    {
      method: "POST",
      headers: await getHeaders(tenantId),
      body: JSON.stringify(opts),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<DocumentDetail>;
}

export async function updateDocument(
  tenantId: string,
  documentId: string,
  updates: {
    title?: string;
    folder_id?: string | null;
    content?: string;
  },
): Promise<DocumentDetail> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/documents/${documentId}`,
    {
      method: "PATCH",
      headers: await getHeaders(tenantId),
      body: JSON.stringify(updates),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<DocumentDetail>;
}

export async function moveDocument(
  tenantId: string,
  documentId: string,
  newFolderId: string | null,
): Promise<DocumentDetail> {
  return updateDocument(tenantId, documentId, { folder_id: newFolderId });
}

export async function renameDocument(
  tenantId: string,
  documentId: string,
  title: string,
): Promise<DocumentDetail> {
  return updateDocument(tenantId, documentId, { title });
}
