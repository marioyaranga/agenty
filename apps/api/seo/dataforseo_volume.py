"""DataForSEO Search Volume live — resultados normalizados."""

from __future__ import annotations

from typing import Any

from seo.dataforseo_http import dataforseo_post

SEARCH_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live"


def fetch_search_volume_live(
    login: str,
    password: str,
    keywords: list[str],
    *,
    location_code: int,
    language_code: str,
    tag: str = "workyai-seo-volume",
) -> list[dict[str, Any]]:
    """Consulta volumen para hasta 1000 keywords por request (v1 capa 50 en orquestador)."""
    if not keywords:
        return []

    payload = [
        {
            "keywords": keywords,
            "location_code": location_code,
            "language_code": language_code,
            "tag": tag,
        }
    ]
    parsed = dataforseo_post(login, password, SEARCH_VOLUME_PATH, payload)
    tasks = parsed.get("tasks") or []
    if not tasks:
        return []

    out: list[dict[str, Any]] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        for result_block in task.get("result") or []:
            if not isinstance(result_block, dict):
                continue
            for item in result_block.get("items") or []:
                if not isinstance(item, dict):
                    continue
                kw = str(item.get("keyword") or "").strip()
                if not kw:
                    continue
                sv = item.get("search_volume")
                entry: dict[str, Any] = {
                    "keyword": kw,
                    "search_volume": sv if sv is not None else None,
                }
                monthly = item.get("monthly_searches")
                if isinstance(monthly, list) and monthly:
                    entry["monthly_searches"] = monthly[:12]
                out.append(entry)
    return out
