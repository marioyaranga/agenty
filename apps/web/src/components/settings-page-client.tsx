"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SeoLocationLanguageFields } from "@/components/settings/seo-settings-fields";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteTenantGeminiApiKey,
  getTenantAiSettings,
  patchTenantAgentChatModel,
  putTenantGeminiApiKey,
  type TenantAiSettings,
} from "@/lib/api/tenant-ai-settings";
import {
  deleteTenantDataforseoSettings,
  getTenantSeoSettings,
  putTenantDataforseoSettings,
  type TenantSeoSettings,
} from "@/lib/api/tenant-seo-settings";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { TenantOption } from "@/lib/types/tenant";

const STORAGE_KEY = "workyai_active_tenant_id";
const ADMIN_ROLES = new Set(["owner", "admin"]);

export function SettingsPageClient({ tenants }: { tenants: TenantOption[] }) {
  const [activeTenantId, setActiveTenantId] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [chatCatalog, setChatCatalog] = useState<TenantAiSettings["agent_chat_models"]>(
    [],
  );
  const [effectiveChatModel, setEffectiveChatModel] = useState("");
  const [chatModelDraft, setChatModelDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [seoConfigured, setSeoConfigured] = useState<boolean | null>(null);
  const [seoLogin, setSeoLogin] = useState("");
  const [seoPassword, setSeoPassword] = useState("");
  const [seoLocationCode, setSeoLocationCode] = useState("2484");
  const [seoLanguageCode, setSeoLanguageCode] = useState("es");
  const [seoDepth, setSeoDepth] = useState("10");
  const [seoDepthMin, setSeoDepthMin] = useState(5);
  const [seoDepthMax, setSeoDepthMax] = useState(30);
  const [savingSeo, setSavingSeo] = useState(false);

  const activeRole = useMemo(() => {
    const t = tenants.find((x) => x.tenantId === activeTenantId);
    return t?.role ?? "";
  }, [tenants, activeTenantId]);

  const canEdit = ADMIN_ROLES.has(activeRole);

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

  const applyAiSettings = useCallback((data: TenantAiSettings) => {
    setConfigured(data.gemini_configured);
    setChatCatalog(data.agent_chat_models);
    setEffectiveChatModel(data.agent_chat_model);
    setChatModelDraft(data.agent_chat_model_stored ?? "");
  }, []);

  const applySeoSettings = useCallback((data: TenantSeoSettings) => {
    setSeoConfigured(data.seo_configured);
    setSeoLocationCode(String(data.location_code));
    setSeoLanguageCode(data.language_code);
    setSeoDepth(String(data.serp_depth));
    setSeoDepthMin(data.serp_depth_min);
    setSeoDepthMax(data.serp_depth_max);
  }, []);

  const loadSettings = useCallback(async () => {
    setConfigured(null);
    if (!activeTenantId) {
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      setMessage("NEXT_PUBLIC_API_URL no está definida.");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setLoading(true);
    try {
      const data = await getTenantAiSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      applyAiSettings(data);
      const seoData = await getTenantSeoSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      applySeoSettings(seoData);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, applyAiSettings, applySeoSettings]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveKey() {
    setMessage(null);
    if (!canEdit) {
      setMessage("Solo owner o admin pueden guardar la clave.");
      return;
    }
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setMessage("Ingresá la clave API.");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase || !activeTenantId) {
      setMessage("Configuración incompleta (API o espacio).");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setSaving(true);
    try {
      const data = await putTenantGeminiApiKey(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
        trimmed,
      );
      setApiKeyInput("");
      applyAiSettings(data);
      setMessage("Clave guardada correctamente.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setMessage(null);
    if (!canEdit) {
      setMessage("Solo owner o admin pueden quitar la clave.");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase || !activeTenantId) {
      setMessage("Configuración incompleta (API o espacio).");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setSaving(true);
    try {
      await deleteTenantGeminiApiKey(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      const data = await getTenantAiSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      applyAiSettings(data);
      setMessage("Clave por tenant eliminada. Se usará la clave global del servidor si existe.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al quitar");
    } finally {
      setSaving(false);
    }
  }

  async function saveSeo() {
    setMessage(null);
    if (!canEdit) {
      setMessage("Solo owner o admin pueden guardar DataForSEO.");
      return;
    }
    const login = seoLogin.trim();
    const password = seoPassword.trim();
    if (!login || !password) {
      setMessage("Ingresá login y password de DataForSEO.");
      return;
    }
    const loc = Number(seoLocationCode);
    const depth = Number(seoDepth);
    if (!Number.isFinite(loc) || loc < 1) {
      setMessage("Ubicación de búsqueda inválida.");
      return;
    }
    if (!Number.isFinite(depth) || depth < seoDepthMin || depth > seoDepthMax) {
      setMessage(`La profundidad SERP debe estar entre ${seoDepthMin} y ${seoDepthMax}.`);
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase || !activeTenantId) {
      setMessage("Configuración incompleta (API o espacio).");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setSavingSeo(true);
    try {
      const data = await putTenantDataforseoSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
        {
          dataforseo_login: login,
          dataforseo_password: password,
          location_code: loc,
          language_code: seoLanguageCode.trim() || "es",
          serp_depth: depth,
        },
      );
      setSeoLogin("");
      setSeoPassword("");
      applySeoSettings(data);
      setMessage("Conexión DataForSEO guardada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar SEO");
    } finally {
      setSavingSeo(false);
    }
  }

  async function clearSeo() {
    setMessage(null);
    if (!canEdit) {
      setMessage("Solo owner o admin pueden quitar credenciales DataForSEO.");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase || !activeTenantId) {
      setMessage("Configuración incompleta (API o espacio).");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setSavingSeo(true);
    try {
      await deleteTenantDataforseoSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      const data = await getTenantSeoSettings(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
      );
      applySeoSettings(data);
      setMessage("Credenciales DataForSEO eliminadas. Los defaults del espacio se conservan.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al quitar SEO");
    } finally {
      setSavingSeo(false);
    }
  }

  async function saveChatModel() {
    setMessage(null);
    if (!canEdit) {
      setMessage("Solo owner o admin pueden guardar el modelo.");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
    if (!apiBase || !activeTenantId) {
      setMessage("Configuración incompleta (API o espacio).");
      return;
    }
    const supabase = createClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      setMessage(
        sessionError?.message ??
          "No hay sesión con access_token. Iniciá sesión de nuevo.",
      );
      return;
    }
    setSavingModel(true);
    try {
      const nextStored = chatModelDraft === "" ? null : chatModelDraft;
      const data = await patchTenantAgentChatModel(
        apiBase,
        sessionData.session.access_token,
        activeTenantId,
        nextStored,
      );
      applyAiSettings(data);
      setMessage("Modelo de chat actualizado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar modelo");
    } finally {
      setSavingModel(false);
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
        <h2 className="text-sm font-medium text-foreground">Gemini (por espacio)</h2>
        <p className="text-sm text-muted-foreground">
          La clave se envía solo al servidor y se guarda cifrada. No se muestra de nuevo.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : configured !== null ? (
          <p className="text-sm text-foreground">
            Estado:{" "}
            <span className="font-medium">
              {configured ? "clave propia configurada" : "sin clave propia (fallback global)"}
            </span>
          </p>
        ) : null}
        {/* Sin membresías cargadas, activeRole queda vacío y canEdit sería false: no mostrar "solo lectura" hasta tener un espacio real. */}
        {tenants.length > 0 && !canEdit ? (
          <p className="text-sm text-muted-foreground" role="status">
            Tu rol en este espacio es solo lectura para esta configuración. Contactá a un
            owner o admin si necesitás cambiar la clave.
          </p>
        ) : tenants.length > 0 && canEdit ? (
          <>
            <Input
              type="password"
              autoComplete="off"
              disabled={saving || !activeTenantId}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Pegá aquí la API key de Google AI Studio"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saving || !activeTenantId}
                onClick={() => void saveKey()}
              >
                {saving ? "Guardando…" : "Guardar clave"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving || !activeTenantId || !configured}
                onClick={() => void clearKey()}
              >
                Quitar clave del espacio
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={loading || !activeTenantId}
                onClick={() => void loadSettings()}
              >
                Actualizar estado
              </Button>
            </div>
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Modelo del agente (chat)</h2>
        <p className="text-sm text-muted-foreground">
          Afecta la reescritura de consulta y la respuesta con contexto RAG. Los embeddings de
          documentos siguen usando el modelo de embedding del servidor.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : effectiveChatModel ? (
          <p className="text-sm text-foreground">
            En uso ahora:{" "}
            <span className="font-medium">{effectiveChatModel}</span>
            {chatModelDraft === "" ? (
              <span className="text-muted-foreground"> (predeterminado del servidor)</span>
            ) : null}
          </p>
        ) : null}
        {tenants.length > 0 && !canEdit ? (
          <p className="text-sm text-muted-foreground" role="status">
            Tu rol en este espacio no permite cambiar el modelo. Contactá a un owner o admin.
          </p>
        ) : tenants.length > 0 && canEdit && chatCatalog.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Modelo</span>
              <select
                className={cn(
                  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "dark:bg-input/30",
                )}
                disabled={savingModel || !activeTenantId}
                value={chatModelDraft === "" ? "" : chatModelDraft}
                onChange={(e) =>
                  setChatModelDraft(e.target.value === "" ? "" : e.target.value)
                }
              >
                <option value="">Predeterminado del servidor</option>
                {chatCatalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={savingModel || !activeTenantId}
              onClick={() => void saveChatModel()}
            >
              {savingModel ? "Guardando…" : "Guardar modelo"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">DataForSEO (por espacio)</h2>
        <p className="text-sm text-muted-foreground">
          Credenciales solo para agentes SEO (volumen y SERP). No hay fallback global:
          cada espacio debe configurar su cuenta.
        </p>
        <p className="text-xs text-muted-foreground">
          SERP: modo <span className="font-medium text-foreground">advanced</span> (fijo en
          v1). Profundidad entre {seoDepthMin} y {seoDepthMax}.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : seoConfigured !== null ? (
          <p className="text-sm text-foreground">
            Estado:{" "}
            <span className="font-medium">
              {seoConfigured ? "credenciales configuradas" : "sin credenciales"}
            </span>
          </p>
        ) : null}
        {tenants.length > 0 && !canEdit ? (
          <p className="text-sm text-muted-foreground" role="status">
            Tu rol no permite cambiar DataForSEO. Contactá a un owner o admin.
          </p>
        ) : tenants.length > 0 && canEdit ? (
          <>
            <Input
              type="text"
              autoComplete="off"
              disabled={savingSeo || !activeTenantId}
              value={seoLogin}
              onChange={(e) => setSeoLogin(e.target.value)}
              placeholder="Login API DataForSEO"
            />
            <Input
              type="password"
              autoComplete="off"
              disabled={savingSeo || !activeTenantId}
              value={seoPassword}
              onChange={(e) => setSeoPassword(e.target.value)}
              placeholder="Password API DataForSEO"
            />
            <SeoLocationLanguageFields
              locationCode={seoLocationCode}
              languageCode={seoLanguageCode}
              serpDepth={seoDepth}
              depthMin={seoDepthMin}
              depthMax={seoDepthMax}
              disabled={savingSeo || !activeTenantId}
              onLocationChange={setSeoLocationCode}
              onLanguageChange={setSeoLanguageCode}
              onDepthChange={setSeoDepth}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={savingSeo || !activeTenantId}
                onClick={() => void saveSeo()}
              >
                {savingSeo ? "Guardando…" : "Guardar conexión"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingSeo || !activeTenantId || !seoConfigured}
                onClick={() => void clearSeo()}
              >
                Quitar credenciales
              </Button>
            </div>
          </>
        ) : null}
      </section>

      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <Link
          href="/dashboard"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Panel
        </Link>
        {" · "}
        <Link
          href="/documents"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Documentos
        </Link>
        {" · "}
        <Link
          href="/chat"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Chat
        </Link>
        {" · "}
        <Link
          href="/seo"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          SEO
        </Link>
      </p>
    </div>
  );
}
