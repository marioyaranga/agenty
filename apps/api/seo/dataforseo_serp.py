"""DataForSEO Google Organic SERP live advanced — resultados normalizados."""

from __future__ import annotations

from typing import Any

from seo.dataforseo_http import dataforseo_post

SERP_ADVANCED_PATH = "/v3/serp/google/organic/live/advanced"


def _extract_organic(items: list[Any], *, max_results: int) -> list[dict[str, Any]]:
    organic: list[dict[str, Any]] = []
    for block in items:
        if not isinstance(block, dict):
            continue
        btype = str(block.get("type") or "").lower()
        if btype == "organic" or block.get("se_type") == "organic":
            pos = block.get("rank_absolute") or block.get("rank_group") or block.get("position")
            organic.append(
                {
                    "position": pos,
                    "title": str(block.get("title") or "").strip() or None,
                    "url": str(block.get("url") or block.get("link") or "").strip() or None,
                    "snippet": str(block.get("description") or block.get("snippet") or "").strip()
                    or None,
                }
            )
            if len(organic) >= max_results:
                break
        nested = block.get("items")
        if isinstance(nested, list) and nested:
            organic.extend(_extract_organic(nested, max_results=max_results - len(organic)))
            if len(organic) >= max_results:
                break
    return organic[:max_results]


def fetch_serp_google_organic_advanced(
    login: str,
    password: str,
    keyword: str,
    *,
    location_code: int,
    language_code: str,
    depth: int,
    tag: str = "workyai-seo-serp",
) -> dict[str, Any]:
    """Una keyword por request; depth fijado por configuración del tenant."""
    kw = keyword.strip()
    if not kw:
        return {"keyword": "", "organic_results": []}

    payload = [
        {
            "keyword": kw,
            "location_code": location_code,
            "language_code": language_code,
            "depth": depth,
            "tag": tag,
        }
    ]
    parsed = dataforseo_post(login, password, SERP_ADVANCED_PATH, payload)
    tasks = parsed.get("tasks") or []
    organic_results: list[dict[str, Any]] = []
    check_url: str | None = None
    fetched_at: str | None = None
    keyword_used = kw

    for task in tasks:
        if not isinstance(task, dict):
            continue
        for result_block in task.get("result") or []:
            if not isinstance(result_block, dict):
                continue
            if result_block.get("keyword"):
                keyword_used = str(result_block["keyword"]).strip() or kw
            check_url = check_url or (
                str(result_block.get("check_url") or "").strip() or None
            )
            fetched_at = fetched_at or (
                str(result_block.get("datetime") or result_block.get("se_datetime") or "").strip()
                or None
            )
            items = result_block.get("items") or []
            if isinstance(items, list):
                organic_results = _extract_organic(items, max_results=depth)

    return {
        "keyword": keyword_used,
        "organic_results": organic_results,
        "check_url": check_url,
        "datetime": fetched_at,
    }
