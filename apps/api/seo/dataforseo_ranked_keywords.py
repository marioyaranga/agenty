"""DataForSEO Labs Ranked Keywords — keywords orgánicas con posición para una URL de página."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse, urlunparse

from seo.dataforseo_http import dataforseo_post

RANKED_KEYWORDS_PATH = "/v3/dataforseo_labs/google/ranked_keywords/live"


def normalize_page_target(raw: str) -> str:
    """DataForSEO exige https:// o www. en el target para acotar a una página, no solo dominio."""
    u = (raw or "").strip()
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = "https://" + u.lstrip("/")
    parsed = urlparse(u)
    if not parsed.netloc:
        return ""
    scheme = "https"
    path = parsed.path if parsed.path else "/"
    return urlunparse((scheme, parsed.netloc.lower(), path, "", parsed.query, ""))


def _parse_ranked_item(item: dict[str, Any]) -> dict[str, Any] | None:
    kd = item.get("keyword_data")
    if not isinstance(kd, dict):
        return None
    kw = str(kd.get("keyword") or "").strip()
    if not kw:
        return None

    rse = item.get("ranked_serp_element")
    si: dict[str, Any] = {}
    if isinstance(rse, dict):
        raw_si = rse.get("serp_item")
        if isinstance(raw_si, dict):
            si = raw_si

    item_type = str(si.get("type") or "organic").lower()
    if item_type and item_type != "organic":
        return None

    position = si.get("rank_group")
    if position is None:
        position = si.get("rank_absolute")

    ki = kd.get("keyword_info") if isinstance(kd.get("keyword_info"), dict) else {}
    return {
        "keyword": kw,
        "position": position,
        "search_volume": ki.get("search_volume"),
        "ranking_url": str(si.get("url") or "").strip() or None,
    }


def fetch_ranked_keywords_for_page(
    login: str,
    password: str,
    page_url: str,
    *,
    location_code: int,
    language_code: str,
    limit: int = 20,
    tag: str = "workyai-ranked-kw",
) -> dict[str, Any]:
    """Keywords orgánicas en las que rankea la URL indicada (DataForSEO Labs, actualización semanal)."""
    target = normalize_page_target(page_url)
    if not target:
        raise ValueError("Se requiere una URL de página válida (con https://).")

    capped = max(1, min(int(limit), 1000))
    payload = [
        {
            "target": target,
            "location_code": location_code,
            "language_code": language_code,
            "limit": capped,
            "item_types": ["organic"],
            "historical_serp_mode": "live",
            "order_by": ["ranked_serp_element.serp_item.rank_group,asc"],
            "tag": tag,
        }
    ]
    parsed = dataforseo_post(login, password, RANKED_KEYWORDS_PATH, payload, timeout=120.0)
    tasks = parsed.get("tasks") or []

    keywords: list[dict[str, Any]] = []
    total_count: int | None = None
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
            tc = result_block.get("total_count")
            if tc is not None:
                try:
                    total_count = int(tc)
                except (TypeError, ValueError):
                    pass
            for item in result_block.get("items") or []:
                if not isinstance(item, dict):
                    continue
                row = _parse_ranked_item(item)
                if row:
                    keywords.append(row)
                if len(keywords) >= capped:
                    break
            if len(keywords) >= capped:
                break

    if task_errors and not keywords:
        raise RuntimeError(f"DataForSEO ranked_keywords: {'; '.join(task_errors)}")

    return {
        "target": target,
        "total_count": total_count,
        "keywords": keywords[:capped],
    }
