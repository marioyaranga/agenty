"""Resolución de la API key de Gemini: por tenant (Postgres + Fernet) o variable global."""

from __future__ import annotations

import os
from typing import Any

from supabase import Client

from secrets_crypto import decrypt_secret


def get_gemini_api_key_for_tenant(client: Client, tenant_id: str) -> str:
    """Lee `tenant_ai_settings`, descifra si hay clave; si no, usa `GEMINI_API_KEY`."""
    res = (
        client.table("tenant_ai_settings")
        .select("gemini_api_key_encrypted")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if rows:
        enc = (rows[0].get("gemini_api_key_encrypted") or "").strip()
        if enc:
            return decrypt_secret(enc)

    fallback = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not fallback:
        raise RuntimeError(
            "No hay clave Gemini: definí GEMINI_API_KEY en el servidor o configurá una clave por tenant."
        )
    return fallback


def resolve_gemini_api_key(
    *,
    api_key: str | None = None,
    client: Client | None = None,
    tenant_id: str | None = None,
) -> str:
    """Prioridad: `api_key` explícita → tenant en base → `GEMINI_API_KEY` global."""
    if api_key and (k := api_key.strip()):
        return k
    if client is not None and tenant_id:
        return get_gemini_api_key_for_tenant(client, tenant_id)
    env_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not env_key:
        raise RuntimeError("GEMINI_API_KEY no configurada")
    return env_key
