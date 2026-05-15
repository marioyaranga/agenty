"""Modelos Gemini permitidos para el agente (reescritura + generación RAG)."""

from __future__ import annotations

import os
from typing import Any

from supabase import Client

# IDs válidos para la API de Google Gemini (AI Studio / generateContent).
DEFAULT_AGENT_CHAT_MODEL = "gemini-2.0-flash"

_AGENT_MODEL_ENTRIES: tuple[tuple[str, str], ...] = (
    ("gemini-2.0-flash", "Gemini 2.0 Flash"),
    ("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
    ("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
)

ALLOWED_AGENT_CHAT_MODELS: frozenset[str] = frozenset(m for m, _ in _AGENT_MODEL_ENTRIES)


def agent_chat_models_catalog() -> list[dict[str, str]]:
    """Lista para el cliente (selector de configuración)."""
    return [{"id": mid, "label": label} for mid, label in _AGENT_MODEL_ENTRIES]


def is_allowed_agent_chat_model(model_id: str) -> bool:
    return bool(model_id) and model_id.strip() in ALLOWED_AGENT_CHAT_MODELS


def _default_from_env() -> str:
    raw = (os.environ.get("AGENT_DEFAULT_CHAT_MODEL") or "").strip()
    if raw and is_allowed_agent_chat_model(raw):
        return raw
    return DEFAULT_AGENT_CHAT_MODEL


def resolve_agent_chat_model(stored: str | None) -> str:
    """Convierte valor en base (o None) en un ID de modelo concreto."""
    if stored:
        s = stored.strip()
        if is_allowed_agent_chat_model(s):
            return s
    return _default_from_env()


def get_agent_chat_model_for_tenant(client: Client, tenant_id: str) -> str:
    """Lee `tenant_ai_settings.agent_chat_model` y aplica fallback seguro."""
    res = (
        client.table("tenant_ai_settings")
        .select("agent_chat_model")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    stored: str | None = None
    if rows:
        raw = rows[0].get("agent_chat_model")
        if raw is not None and str(raw).strip():
            stored = str(raw).strip()
    return resolve_agent_chat_model(stored)
