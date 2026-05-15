"""DataForSEO Google Ads Keywords for Site live — keywords de una o varias URLs."""

from __future__ import annotations

from typing import Any

from seo.dataforseo_http import dataforseo_post

KEYWORDS_FOR_SITE_PATH = "/v3/keywords_data/google_ads/keywords_for_site/live"


def _parse_items(result_block: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
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
        if len(out) >= limit:
            break
    return out


def fetch_keywords_for_urls(
    login: str,
    password: str,
    targets: list[str],
    *,
    location_code: int,
    language_code: str,
    limit_per_target: int = 20,
    tag: str = "workyai-seo-kw-url",
) -> dict[str, list[dict[str, Any]]]:
    """Un POST con una task por target; devuelve dict target → keywords."""
    clean_targets = [t.strip() for t in targets if t.strip()]
    if not clean_targets:
        return {}

    capped = max(1, min(limit_per_target, 1000))
    payload = [
        {
            "target": t,
            "location_code": location_code,
            "language_code": language_code,
            "limit": capped,
            "tag": tag,
        }
        for t in clean_targets
    ]
    parsed = dataforseo_post(login, password, KEYWORDS_FOR_SITE_PATH, payload)
    tasks = parsed.get("tasks") or []

    # Construimos el mapa target → keywords usando el campo `target` del result_block.
    # Como fallback usamos el índice de la task para mapear al target enviado.
    result_map: dict[str, list[dict[str, Any]]] = {t: [] for t in clean_targets}
    task_errors: list[str] = []

    for idx, task in enumerate(tasks):
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
            # DataForSEO devuelve el target en el result_block; fallback al índice posicional.
            block_target = str(result_block.get("target") or "").strip()
            if not block_target and idx < len(clean_targets):
                block_target = clean_targets[idx]
            if block_target not in result_map:
                # target con protocolo distinto al enviado — igualamos el más cercano
                for ct in clean_targets:
                    if block_target.endswith(ct) or ct.endswith(block_target):
                        block_target = ct
                        break
                else:
                    block_target = clean_targets[idx] if idx < len(clean_targets) else block_target
            items = _parse_items(result_block, capped)
            result_map.setdefault(block_target, []).extend(items)

    if task_errors and all(not v for v in result_map.values()):
        raise RuntimeError(f"DataForSEO keywords_for_urls: {'; '.join(task_errors)}")

    return result_map
