"""Tools SEO para function calling de Gemini (volumen, SERP y ranked keywords vía DataForSEO).

Reusan la infra de seo/ y se integran al loop generate↔execute_tool del agente RAG.
Los resultados incluyen seo=True y phase="dataforseo" para que format_seo_steps_for_ui
los interprete como pasos SEO al construir la respuesta del endpoint.
"""

from __future__ import annotations

from typing import Any

from supabase import Client

from routes.documents import EDITOR_ROLES
from seo.dataforseo_ranked_keywords import fetch_ranked_keywords_for_page, normalize_page_target
from seo.dataforseo_serp import fetch_serp_google_organic_advanced
from seo.dataforseo_volume import fetch_search_volume_live
from seo.seo_cache import (
    TTL_RANKED_KW_SECONDS,
    TTL_SERP_SECONDS,
    TTL_VOLUME_SECONDS,
    get_cached,
    make_ranked_kw_key,
    make_serp_key,
    make_volume_key,
    set_cached,
)
from seo.seo_format import _format_answer_markdown
from seo.seo_keys import (
    dataforseo_configured,
    get_dataforseo_secrets_for_tenant,
    get_effective_seo_defaults,
)
from tenant_http import membership_role


def _check_seo_role(client: Client, tenant_id: str, user_id: str) -> str | None:
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return "Se requiere rol editor, admin u owner para consultas SEO"
    return None


def tool_seo_search_volume(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    keywords: list[str],
    location_code: int | None = None,
    language_code: str | None = None,
) -> dict[str, Any]:
    err = _check_seo_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    if not dataforseo_configured(client, tenant_id):
        return {
            "ok": False,
            "reason": "dataforseo_not_configured",
            "error": (
                "DataForSEO no está configurado para este espacio. "
                "Configurá las credenciales en Ajustes → DataForSEO."
            ),
        }

    secrets = get_dataforseo_secrets_for_tenant(client, tenant_id)
    if not secrets:
        return {"ok": False, "error": "No se pudieron cargar las credenciales DataForSEO."}
    login, password = secrets

    defaults = get_effective_seo_defaults(client, tenant_id)
    loc = location_code if location_code is not None else defaults["location_code"]
    lang = language_code if language_code else defaults["language_code"]

    kws = [str(k).strip() for k in (keywords or []) if str(k).strip()][:50]
    if not kws:
        return {"ok": False, "error": "Se requiere al menos una keyword."}

    try:
        vol_key = make_volume_key(kws, loc, lang)
        cached_hit = get_cached(client, tenant_id, vol_key)
        if cached_hit is not None:
            rows = cached_hit
            from_cache = True
        else:
            rows = fetch_search_volume_live(login, password, kws, location_code=loc, language_code=lang)
            set_cached(client, tenant_id, vol_key, "volume", rows, TTL_VOLUME_SECONDS)
            from_cache = False
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error DataForSEO volumen: {exc}"}

    markdown = _format_answer_markdown(
        defaults=defaults,
        mode="volume",
        keywords=kws,
        volume_results=rows,
        serp_results=[],
    )
    return {
        "ok": True,
        "seo": True,
        "phase": "dataforseo",
        "mode": "volume",
        "cached": from_cache,
        "markdown": markdown,
        "volume_summary": [
            {"keyword": r.get("keyword"), "search_volume": r.get("search_volume")}
            for r in rows[:50]
        ],
        "volume_row_count": len(rows),
        "serp_block_count": 0,
        "keyword_count": len(kws),
        "keywords": kws[:20],
        "location_code": loc,
        "language_code": lang,
    }


def _ranked_kw_table_lines(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| # | Keyword | Posición orgánica | Volumen mensual |",
        "| --- | --- | ---: | ---: |",
    ]
    for i, r in enumerate(rows, 1):
        kw = r.get("keyword") or ""
        pos = r.get("position")
        pos_s = "—" if pos is None else str(pos)
        sv = "—" if r.get("search_volume") is None else str(r["search_volume"])
        lines.append(f"| {i} | {kw} | {pos_s} | {sv} |")
    return lines


def tool_seo_ranked_keywords_for_url(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    url: str,
    limit: int | None = None,
    location_code: int | None = None,
    language_code: str | None = None,
) -> dict[str, Any]:
    err = _check_seo_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    if not dataforseo_configured(client, tenant_id):
        return {
            "ok": False,
            "reason": "dataforseo_not_configured",
            "error": (
                "DataForSEO no está configurado para este espacio. "
                "Configurá las credenciales en Ajustes → DataForSEO."
            ),
        }

    secrets = get_dataforseo_secrets_for_tenant(client, tenant_id)
    if not secrets:
        return {"ok": False, "error": "No se pudieron cargar las credenciales DataForSEO."}
    login, password = secrets

    defaults = get_effective_seo_defaults(client, tenant_id)
    loc = location_code if location_code is not None else defaults["location_code"]
    lang = language_code if language_code else defaults["language_code"]
    lim = limit if limit is not None else 20

    page_target = normalize_page_target(url or "")
    if not page_target:
        return {
            "ok": False,
            "error": (
                "Se requiere la URL completa de la página (con https://), "
                "no solo el dominio, para obtener rankings de esa URL específica."
            ),
        }

    try:
        cache_key = make_ranked_kw_key(page_target, loc, lang, lim)
        cached_hit = get_cached(client, tenant_id, cache_key)
        if cached_hit is not None:
            result = cached_hit
            from_cache = True
        else:
            result = fetch_ranked_keywords_for_page(
                login,
                password,
                page_target,
                location_code=loc,
                language_code=lang,
                limit=lim,
            )
            set_cached(
                client, tenant_id, cache_key, "ranked_keywords", result, TTL_RANKED_KW_SECONDS
            )
            from_cache = False
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error DataForSEO ranked keywords: {exc}"}

    rows = list(result.get("keywords") or [])
    total_in_db = result.get("total_count")

    lines: list[str] = [
        "## Keywords orgánicas por URL (ranked keywords)",
        "",
        f"**Página:** `{page_target}`",
        f"**Configuración usada:** location_code={loc}, language_code={lang}, "
        f"límite={lim}, resultados={len(rows)}"
        + (f" (total estimado en índice: {total_in_db})" if total_in_db is not None else "")
        + ".",
        "",
    ]
    if rows:
        lines.extend(_ranked_kw_table_lines(rows))
    else:
        lines.append("_Sin keywords orgánicas en vivo para esta URL en el mercado/idioma indicado._")
    lines.extend(
        [
            "",
            "_Datos: DataForSEO Labs (ranked keywords, orgánico). "
            "Actualización semanal; posiciones son snapshot del índice, no tiempo real._",
        ]
    )
    markdown = "\n".join(lines).strip()

    keywords_summary = [
        {
            "target": page_target,
            "keyword": r.get("keyword"),
            "position": r.get("position"),
            "search_volume": r.get("search_volume"),
        }
        for r in rows[:50]
    ]

    return {
        "ok": True,
        "seo": True,
        "phase": "dataforseo",
        "mode": "ranked_keywords",
        "cached": from_cache,
        "markdown": markdown,
        "keywords_summary": keywords_summary,
        "keyword_count": len(rows),
        "target_url": page_target,
        "total_count": total_in_db,
        "location_code": loc,
        "language_code": lang,
    }


def tool_seo_keywords_for_url(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    urls: list[str] | None = None,
    url: str | None = None,
    limit: int | None = None,
    location_code: int | None = None,
    language_code: str | None = None,
) -> dict[str, Any]:
    """Alias retrocompatible: acepta `url` o el primer elemento de `urls`."""
    page = (url or "").strip()
    if not page and urls:
        for candidate in urls:
            page = str(candidate or "").strip()
            if page:
                break
    return tool_seo_ranked_keywords_for_url(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        url=page,
        limit=limit,
        location_code=location_code,
        language_code=language_code,
    )


def tool_seo_serp_organic(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    keyword: str,
    depth: int | None = None,
    location_code: int | None = None,
    language_code: str | None = None,
) -> dict[str, Any]:
    err = _check_seo_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    if not dataforseo_configured(client, tenant_id):
        return {
            "ok": False,
            "reason": "dataforseo_not_configured",
            "error": (
                "DataForSEO no está configurado para este espacio. "
                "Configurá las credenciales en Ajustes → DataForSEO."
            ),
        }

    secrets = get_dataforseo_secrets_for_tenant(client, tenant_id)
    if not secrets:
        return {"ok": False, "error": "No se pudieron cargar las credenciales DataForSEO."}
    login, password = secrets

    defaults = get_effective_seo_defaults(client, tenant_id)
    loc = location_code if location_code is not None else defaults["location_code"]
    lang = language_code if language_code else defaults["language_code"]
    dep = depth if depth is not None else defaults["serp_depth"]

    kw = (keyword or "").strip()
    if not kw:
        return {"ok": False, "error": "Se requiere la keyword."}

    try:
        serp_key = make_serp_key(kw, loc, lang, dep)
        serp_hit = get_cached(client, tenant_id, serp_key)
        if serp_hit is not None:
            serp = serp_hit
            from_cache = True
        else:
            serp = fetch_serp_google_organic_advanced(
                login, password, kw, location_code=loc, language_code=lang, depth=dep
            )
            set_cached(client, tenant_id, serp_key, "serp", serp, TTL_SERP_SECONDS)
            from_cache = False
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error DataForSEO SERP: {exc}"}

    markdown = _format_answer_markdown(
        defaults=defaults,
        mode="serp",
        keywords=[kw],
        volume_results=[],
        serp_results=[serp],
    )
    return {
        "ok": True,
        "seo": True,
        "phase": "dataforseo",
        "cached": from_cache,
        "mode": "serp",
        "markdown": markdown,
        "serp_summary": [
            {
                "keyword": serp.get("keyword"),
                "top": [
                    {
                        "position": t.get("position"),
                        "title": (t.get("title") or "")[:120],
                        "url": (t.get("url") or "")[:200],
                    }
                    for t in (serp.get("organic_results") or [])[:3]
                ],
            }
        ],
        "serp_block_count": 1,
        "volume_row_count": 0,
        "keyword_count": 1,
        "keywords": [kw],
        "location_code": loc,
        "language_code": lang,
    }
