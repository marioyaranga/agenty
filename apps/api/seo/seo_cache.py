"""Caché de resultados DataForSEO en Postgres, scoped por tenant con TTL."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

TTL_VOLUME_SECONDS = 86_400   # 24 h — volumen Google Ads cambia mensualmente
TTL_SERP_SECONDS   = 21_600   # 6 h  — SERP cambia más frecuentemente
TTL_RANKED_KW_SECONDS = 604_800  # 7 d — Labs ranked keywords (datos semanales)


# ── Construcción de claves ────────────────────────────────────────────────────

def _sha(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def make_volume_key(keywords: list[str], location_code: int, language_code: str) -> str:
    kws = ",".join(sorted(k.lower().strip() for k in keywords if k.strip()))
    return _sha(f"volume:{location_code}:{language_code.lower()}:{kws}")


def make_serp_key(keyword: str, location_code: int, language_code: str, depth: int) -> str:
    return _sha(f"serp:{location_code}:{language_code.lower()}:{depth}:{keyword.lower().strip()}")


def make_ranked_kw_key(page_url: str, location_code: int, language_code: str, limit: int) -> str:
    return _sha(
        f"ranked_kw:{location_code}:{language_code.lower()}:{limit}:{page_url.lower().strip()}"
    )


# ── Acceso a la tabla ─────────────────────────────────────────────────────────

def get_cached(client: Client, tenant_id: str, cache_key: str) -> Any | None:
    """Devuelve result_json si existe una entrada válida; None si no hay hit."""
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        res = (
            client.table("seo_cache")
            .select("result_json")
            .eq("tenant_id", tenant_id)
            .eq("cache_key", cache_key)
            .gt("expires_at", now_iso)
            .limit(1)
            .execute()
        )
        rows: list[dict] = res.data or []
        if rows:
            return rows[0]["result_json"]
    except Exception:  # noqa: BLE001 — caché nunca debe romper el flujo
        pass
    return None


def set_cached(
    client: Client,
    tenant_id: str,
    cache_key: str,
    endpoint_type: str,
    result: Any,
    ttl_seconds: int,
) -> None:
    """Guarda (o reemplaza) una entrada en caché. Falla silenciosamente."""
    try:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()
        client.table("seo_cache").upsert(
            {
                "tenant_id": tenant_id,
                "cache_key": cache_key,
                "endpoint_type": endpoint_type,
                "result_json": result,
                "expires_at": expires_at,
            },
            on_conflict="tenant_id,cache_key",
        ).execute()
    except Exception:  # noqa: BLE001
        pass
