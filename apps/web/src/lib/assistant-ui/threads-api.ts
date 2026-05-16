import { createClient } from "@/lib/supabase/client";
import type { AgentRunStep } from "@/lib/types/agent-steps";

export type ThreadItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ThreadRun = {
  run_id: string;
  input_message: string;
  output_message: string | null;
  status: string;
  citations: unknown[];
  web_sources?: Array<{ uri: string; title: string }>;
  created_at: string;
  steps?: AgentRunStep[];
};

export type ThreadDetail = ThreadItem & { runs: ThreadRun[] };

export type ThreadsListResponse = {
  items: ThreadItem[];
  next_cursor: string | null;
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

export async function listThreads(
  tenantId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<ThreadsListResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  const qs = params.size ? `?${params.toString()}` : "";

  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/agent/threads${qs}`,
    { headers: await getHeaders(tenantId) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ThreadsListResponse>;
}

export async function createThread(
  tenantId: string,
  title?: string,
): Promise<ThreadItem> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/agent/threads`,
    {
      method: "POST",
      headers: await getHeaders(tenantId),
      body: JSON.stringify({ title: title ?? "Nueva conversación" }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ThreadItem>;
}

export async function renameThread(
  tenantId: string,
  threadId: string,
  title: string,
): Promise<ThreadItem> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/agent/threads/${threadId}`,
    {
      method: "PATCH",
      headers: await getHeaders(tenantId),
      body: JSON.stringify({ title }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ThreadItem>;
}

export async function getThread(
  tenantId: string,
  threadId: string,
): Promise<ThreadDetail> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/agent/threads/${threadId}`,
    { headers: await getHeaders(tenantId) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ThreadDetail>;
}

export async function deleteThread(
  tenantId: string,
  threadId: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase()}/v1/tenants/${tenantId}/agent/threads/${threadId}`,
    { method: "DELETE", headers: await getHeaders(tenantId) },
  );
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
}
