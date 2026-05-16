export type AgentChatModelOption = { id: string; label: string };

export type TenantAiSettings = {
  gemini_configured: boolean;
  agent_chat_model: string;
  agent_chat_model_stored: string | null;
  agent_chat_models: AgentChatModelOption[];
  web_grounding_enabled: boolean;
};

export async function getTenantAiSettings(
  apiBase: string,
  accessToken: string,
  tenantId: string,
): Promise<TenantAiSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/ai`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | TenantAiSettings
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
    !("gemini_configured" in body) ||
    !("agent_chat_model" in body) ||
    !("agent_chat_models" in body)
  ) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantAiSettings;
}

export async function putTenantGeminiApiKey(
  apiBase: string,
  accessToken: string,
  tenantId: string,
  geminiApiKey: string,
): Promise<TenantAiSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/ai`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gemini_api_key: geminiApiKey }),
  });
  const body = (await res.json().catch(() => null)) as
    | TenantAiSettings
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
    !("gemini_configured" in body) ||
    !("agent_chat_model" in body)
  ) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantAiSettings;
}

export async function patchTenantAgentChatModel(
  apiBase: string,
  accessToken: string,
  tenantId: string,
  agentChatModel: string | null,
): Promise<TenantAiSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/ai`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_chat_model: agentChatModel }),
  });
  const body = (await res.json().catch(() => null)) as
    | TenantAiSettings
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
    !("gemini_configured" in body) ||
    !("agent_chat_model" in body)
  ) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantAiSettings;
}

export async function patchTenantWebGrounding(
  apiBase: string,
  accessToken: string,
  tenantId: string,
  enabled: boolean,
): Promise<TenantAiSettings> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/ai`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant-Id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ web_grounding_enabled: enabled }),
  });
  const body = (await res.json().catch(() => null)) as
    | TenantAiSettings
    | { error?: string }
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || typeof body !== "object" || !("gemini_configured" in body)) {
    throw new Error("Respuesta inválida del servidor.");
  }
  return body as TenantAiSettings;
}

export async function deleteTenantGeminiApiKey(
  apiBase: string,
  accessToken: string,
  tenantId: string,
): Promise<void> {
  const base = apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/tenants/${tenantId}/settings/ai`, {
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
