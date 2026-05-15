import { createClient } from "@/lib/supabase/client";

export type FolderItem = {
  id: string;
  parent_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentItem = {
  id: string;
  folder_id: string | null;
  title: string;
  mime_type: string;
  size_bytes: number;
  index_status: "pending" | "ready" | "failed";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TreeResponse = {
  folders: FolderItem[];
  documents: DocumentItem[];
};

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

export async function fetchTree(tenantId: string): Promise<TreeResponse> {
  const res = await fetch(`${apiBase()}/v1/tenants/${tenantId}/folders`, {
    headers: await getHeaders(tenantId),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TreeResponse>;
}

export async function createFolder(
  tenantId: string,
  name: string,
  parentId?: string | null,
): Promise<FolderItem> {
  const res = await fetch(`${apiBase()}/v1/tenants/${tenantId}/folders`, {
    method: "POST",
    headers: await getHeaders(tenantId),
    body: JSON.stringify({ name, parent_id: parentId ?? null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<FolderItem>;
}

export async function renameFolder(
  tenantId: string,
  folderId: string,
  name: string,
): Promise<FolderItem> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/folders/${folderId}`,
    {
      method: "PATCH",
      headers: await getHeaders(tenantId),
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<FolderItem>;
}

export async function moveFolder(
  tenantId: string,
  folderId: string,
  newParentId: string | null,
): Promise<FolderItem> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/folders/${folderId}`,
    {
      method: "PATCH",
      headers: await getHeaders(tenantId),
      body: JSON.stringify({ parent_id: newParentId }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<FolderItem>;
}

export async function deleteFolder(
  tenantId: string,
  folderId: string,
  force = false,
): Promise<void> {
  const url = `${apiBase()}/v1/tenants/${tenantId}/folders/${folderId}${force ? "?force=true" : ""}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: await getHeaders(tenantId),
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    const body = err as { error?: string; children_count?: number };
    const e = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
      status?: number;
      childrenCount?: number;
    };
    e.status = res.status;
    e.childrenCount = body.children_count;
    throw e;
  }
}
