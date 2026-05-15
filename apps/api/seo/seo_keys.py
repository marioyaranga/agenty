"""Credenciales y defaults SEO por tenant (sin fallback global de DataForSEO)."""

from __future__ import annotations

from typing import Any, TypedDict

from supabase import Client

from secrets_crypto import decrypt_secret

DEFAULT_LOCATION_CODE = 2484
DEFAULT_LANGUAGE_CODE = "es"
DEFAULT_SERP_MODE = "advanced"
DEFAULT_SERP_DEPTH = 10
MIN_SERP_DEPTH = 5
MAX_SERP_DEPTH = 30


class SeoDefaults(TypedDict):
    location_code: int
    language_code: str
    serp_mode: str
    serp_depth: int


def _clamp_depth(depth: int) -> int:
    return max(MIN_SERP_DEPTH, min(MAX_SERP_DEPTH, depth))


def get_effective_seo_defaults(client: Client, tenant_id: str) -> SeoDefaults:
    """Defaults efectivos: fila del tenant o valores por defecto del sistema."""
    res = (
        client.table("tenant_seo_settings")
        .select(
            "seo_location_code, seo_language_code, seo_serp_mode, seo_serp_depth"
        )
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return {
            "location_code": DEFAULT_LOCATION_CODE,
            "language_code": DEFAULT_LANGUAGE_CODE,
            "serp_mode": DEFAULT_SERP_MODE,
            "serp_depth": DEFAULT_SERP_DEPTH,
        }
    row = rows[0]
    try:
        loc = int(row.get("seo_location_code") or DEFAULT_LOCATION_CODE)
    except (TypeError, ValueError):
        loc = DEFAULT_LOCATION_CODE
    lang = str(row.get("seo_language_code") or DEFAULT_LANGUAGE_CODE).strip() or DEFAULT_LANGUAGE_CODE
    mode = str(row.get("seo_serp_mode") or DEFAULT_SERP_MODE).strip() or DEFAULT_SERP_MODE
    try:
        depth = int(row.get("seo_serp_depth") or DEFAULT_SERP_DEPTH)
    except (TypeError, ValueError):
        depth = DEFAULT_SERP_DEPTH
    return {
        "location_code": loc,
        "language_code": lang,
        "serp_mode": mode,
        "serp_depth": _clamp_depth(depth),
    }


def dataforseo_configured(client: Client, tenant_id: str) -> bool:
    secrets = get_dataforseo_secrets_for_tenant(client, tenant_id)
    return secrets is not None


def get_dataforseo_secrets_for_tenant(
    client: Client, tenant_id: str
) -> tuple[str, str] | None:
    """Login y password descifrados; None si no hay credenciales del tenant."""
    res = (
        client.table("tenant_seo_settings")
        .select("dataforseo_login_encrypted, dataforseo_password_encrypted")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return None
    enc_login = (rows[0].get("dataforseo_login_encrypted") or "").strip()
    enc_pass = (rows[0].get("dataforseo_password_encrypted") or "").strip()
    if not enc_login or not enc_pass:
        return None
    try:
        login = decrypt_secret(enc_login)
        password = decrypt_secret(enc_pass)
    except ValueError:
        return None
    if not login.strip() or not password.strip():
        return None
    return login.strip(), password.strip()
