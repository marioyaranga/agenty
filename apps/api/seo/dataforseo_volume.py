"""DataForSEO Google Ads Search Volume live — resultados normalizados."""

from __future__ import annotations

from typing import Any

from seo.dataforseo_http import dataforseo_post

# Google Ads: cada keyword viene en tasks[].result[] (sin .items).
# Clickstream search volume usa tasks[].result[].items[].
SEARCH_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live"


def _volume_row_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    kw = str(item.get("keyword") or "").strip()
    if not kw:
        return None
    sv = item.get("search_volume")
    entry: dict[str, Any] = {
        "keyword": kw,
        "search_volume": sv if sv is not None else None,
    }
    monthly = item.get("monthly_searches")
    if isinstance(monthly, list) and monthly:
        entry["monthly_searches"] = monthly[:12]
    return entry


def _collect_rows_from_result_block(
    result_block: dict[str, Any],
    out: list[dict[str, Any]],
) -> None:
    items = result_block.get("items")
    if isinstance(items, list) and items:
        for item in items:
            if not isinstance(item, dict):
                continue
            row = _volume_row_from_item(item)
            if row:
                out.append(row)
        return
    if "keyword" in result_block:
        row = _volume_row_from_item(result_block)
        if row:
            out.append(row)


def fetch_search_volume_live(
    login: str,
    password: str,
    keywords: list[str],
    *,
    location_code: int,
    language_code: str,
    tag: str = "workyai-seo-volume",
) -> list[dict[str, Any]]:
    """Consulta volumen (Google Ads live) para hasta 1000 keywords por request."""
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
            if isinstance(result_block, dict):
                _collect_rows_from_result_block(result_block, out)

    if task_errors and not out:
        raise RuntimeError(f"DataForSEO volumen: {'; '.join(task_errors)}")
    return out
