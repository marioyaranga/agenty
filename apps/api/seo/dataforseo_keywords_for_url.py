"""DataForSEO Google Ads Keywords for Site live — keywords de una URL o dominio."""

from __future__ import annotations

from typing import Any

from seo.dataforseo_http import dataforseo_post

KEYWORDS_FOR_SITE_PATH = "/v3/keywords_data/google_ads/keywords_for_site/live"


def fetch_keywords_for_url(
    login: str,
    password: str,
    target: str,
    *,
    location_code: int,
    language_code: str,
    limit: int = 20,
    tag: str = "workyai-seo-kw-url",
) -> list[dict[str, Any]]:
    """Retorna keywords asociadas a un dominio/URL vía Google Ads."""
    target = target.strip()
    if not target:
        return []

    payload = [
        {
            "target": target,
            "location_code": location_code,
            "language_code": language_code,
            "limit": max(1, min(limit, 1000)),
            "tag": tag,
        }
    ]
    parsed = dataforseo_post(login, password, KEYWORDS_FOR_SITE_PATH, payload)
    tasks = parsed.get("tasks") or []
    if not tasks:
        return []

    out: list[dict[str, Any]] = []
    task_errors: list[str] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        tsc = task.get("status_code")
        if tsc is not None and int(tsc) != 20000:
            msg = str(task.get("status_message") or f"status_code={tsc}")
            task_errors.append(msg)
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
                out.append(
                    {
                        "keyword": kw,
                        "search_volume": item.get("search_volume"),
                        "competition": item.get("competition"),
                        "cpc": item.get("cpc"),
                    }
                )

    if task_errors and not out:
        raise RuntimeError(f"DataForSEO keywords_for_url: {'; '.join(task_errors)}")
    return out[:limit]
