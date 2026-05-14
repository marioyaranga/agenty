export type AuditEventRow = {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  agent_run_id: string | null;
  created_at: string;
};

export type AuditListResponse = {
  items: AuditEventRow[];
  next_cursor: string | null;
};

export async function fetchTenantAuditPage(
  apiBase: string,
  accessToken: string,
  tenantId: string,
  options?: { limit?: number; cursor?: string | null },
): Promise<AuditListResponse> {
  const base = apiBase.replace(/\/+$/, "");
  const limit = options?.limit ?? 50;
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  const res = await fetch(
    `${base}/v1/tenants/${tenantId}/audit?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-Id": tenantId,
      },
      cache: "no-store",
    },
  );
  const body = (await res.json().catch(() => null)) as
    | AuditListResponse
    | { error?: string }
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("items" in body) ||
    !Array.isArray((body as AuditListResponse).items)
  ) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as AuditListResponse;
}
