"""Tools SEO para function calling de Gemini (volumen y SERP vía DataForSEO).

Reusan la infra de seo/ y se integran al loop generate↔execute_tool del agente RAG.
Los resultados incluyen seo=True y phase="dataforseo" para que format_seo_steps_for_ui
los interprete como pasos SEO al construir la respuesta del endpoint.
"""

from __future__ import annotations

from typing import Any

from supabase import Client

from routes.documents import EDITOR_ROLES
from seo.dataforseo_keywords_for_url import fetch_keywords_for_url
from seo.dataforseo_serp import fetch_serp_google_organic_advanced
from seo.dataforseo_volume import fetch_search_volume_live
from seo.seo_graph import _format_answer_markdown
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
        rows = fetch_search_volume_live(login, password, kws, location_code=loc, language_code=lang)
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


def tool_seo_keywords_for_url(
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

    target = (url or "").strip()
    if not target:
        return {"ok": False, "error": "Se requiere la URL o dominio a analizar."}

    try:
        rows = fetch_keywords_for_url(
            login, password, target, location_code=loc, language_code=lang, limit=lim
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error DataForSEO keywords_for_url: {exc}"}

    lines: list[str] = [
        f"## Keywords para `{target}`",
        "",
        f"**Configuración usada:** location_code={loc}, language_code={lang}, limit={lim}.",
        "",
    ]
    if rows:
        lines.append("| # | Keyword | Volumen mensual | CPC | Competencia |")
        lines.append("| --- | --- | ---: | ---: | ---: |")
        for i, r in enumerate(rows, 1):
            kw = r.get("keyword") or ""
            sv = "—" if r.get("search_volume") is None else str(r["search_volume"])
            cpc_v = r.get("cpc")
            cpc = "—" if cpc_v is None else f"${float(cpc_v):.2f}"
            comp_v = r.get("competition")
            comp = "—" if comp_v is None else f"{float(comp_v):.2f}"
            lines.append(f"| {i} | {kw} | {sv} | {cpc} | {comp} |")
        lines.append("")
        lines.append("_Datos: DataForSEO / Google Ads. Volúmenes son estimaciones mensuales._")
    else:
        lines.append("DataForSEO no devolvió keywords para esta URL/dominio.")

    markdown = "\n".join(lines).strip()

    return {
        "ok": True,
        "seo": True,
        "phase": "dataforseo",
        "mode": "keywords_for_url",
        "markdown": markdown,
        "keywords_summary": [
            {"keyword": r.get("keyword"), "search_volume": r.get("search_volume")}
            for r in rows
        ],
        "keyword_count": len(rows),
        "target_url": target,
        "location_code": loc,
        "language_code": lang,
    }


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
        serp = fetch_serp_google_organic_advanced(
            login, password, kw, location_code=loc, language_code=lang, depth=dep
        )
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
