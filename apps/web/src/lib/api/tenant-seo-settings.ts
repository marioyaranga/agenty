export type TenantSeoSettings = {
  seo_configured: boolean;
  location_code: number;
  language_code: string;
  serp_mode: string;
  serp_depth: number;
  serp_depth_min: number;
  serp_depth_max: number;
};

export type PutTenantSeoSettingsBody = {
  dataforseo_login: string;
  dataforseo_password: string;
  location_code: number;
  language_code: string;
  serp_depth: number;
};

export async function getTenantSeoSettings(
  apiBase: string,
  accessToken: string,
  tenantId: string,
): Promise<TenantSeoSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/seo`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | TenantSeoSettings
    | { error?: string }
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || typeof body !== "object" || !("seo_configured" in body)) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantSeoSettings;
}

export async function putTenantDataforseoSettings(
  apiBase: string,
  accessToken: string,
  tenantId: string,
  payload: PutTenantSeoSettingsBody,
): Promise<TenantSeoSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/seo`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as
    | TenantSeoSettings
    | { error?: string }
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || typeof body !== "object" || !("seo_configured" in body)) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantSeoSettings;
}

export async function deleteTenantDataforseoSettings(
  apiBase: string,
  accessToken: string,
  tenantId: string,
): Promise<void> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/seo`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
    },
  });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const msg =
      body && typeof body === "object" && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
}
