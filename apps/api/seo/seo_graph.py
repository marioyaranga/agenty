"""Orquestador SEO (LangGraph): parseo Gemini → volumen/SERP → respuesta en español."""

from __future__ import annotations

import json
import re
from typing import Any, Literal, TypedDict

from google import genai
from langgraph.graph import END, START, StateGraph
from supabase import Client

from agent.persistence import safe_insert_agent_step
from agent.tracing import traced_graph_node
from agent_chat_models import DEFAULT_AGENT_CHAT_MODEL
from seo.dataforseo_serp import fetch_serp_google_organic_advanced
from seo.dataforseo_volume import fetch_search_volume_live
from seo.seo_keys import SeoDefaults

MAX_VOLUME_KEYWORDS = 50
MAX_SERP_KEYWORDS = 10

SeoMode = Literal["volume", "serp", "both"]


class SeoGraphState(TypedDict, total=False):
    tenant_id: str
    user_id: str
    message: str
    gemini_api_key: str
    chat_model: str
    seo_defaults: SeoDefaults
    dataforseo_login: str
    dataforseo_password: str
    mode: SeoMode
    keywords: list[str]
    volume_results: list[dict[str, Any]]
    serp_results: list[dict[str, Any]]
    answer: str


def _normalize_keywords(raw: list[Any], *, max_count: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s[:200])
        if len(out) >= max_count:
            break
    return out


def parse_seo_request_with_gemini(
    message: str,
    *,
    api_key: str,
    model: str | None = None,
) -> tuple[SeoMode, list[str]]:
    """Extrae mode y keywords desde texto libre vía Gemini (JSON estricto)."""
    base = (message or "").strip()
    if not base:
        return "volume", []

    prompt = (
        "Analizá el mensaje del usuario sobre SEO y devolvé SOLO un objeto JSON válido "
        '(sin markdown) con exactamente estas claves:\n'
        '- "mode": "volume" | "serp" | "both"\n'
        '- "keywords": array de strings (keywords o frases de búsqueda, sin duplicados)\n\n'
        "Reglas:\n"
        '- "volume" si pide volumen de búsqueda, tendencia o search volume.\n'
        '- "serp" si pide SERP, resultados orgánicos o ranking en Google.\n'
        '- "both" si pide ambas cosas.\n'
        "- Máximo 50 keywords en el array.\n"
        "- Español o inglés en el mensaje.\n\n"
        f"Mensaje:\n{base[:8000]}"
    )
    mid = (model or "").strip() or DEFAULT_AGENT_CHAT_MODEL
    client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(model=mid, contents=prompt)
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return _heuristic_parse(base)

    mode_raw = str(data.get("mode") or "volume").strip().lower()
    mode: SeoMode = "both" if mode_raw == "both" else "serp" if mode_raw == "serp" else "volume"
    kws = data.get("keywords")
    if not isinstance(kws, list):
        kws = []
    keywords = _normalize_keywords(kws, max_count=MAX_VOLUME_KEYWORDS)
    if not keywords:
        keywords = _heuristic_parse(base)[1]
    return mode, keywords


def _heuristic_parse(message: str) -> tuple[SeoMode, list[str]]:
    lower = message.lower()
    wants_serp = any(
        x in lower for x in ("serp", "resultados org", "ranking", "top 10", "posición")
    )
    wants_vol = any(
        x in lower
        for x in ("volumen", "volume", "búsquedas", "busquedas", "search volume")
    )
    if wants_serp and wants_vol:
        mode: SeoMode = "both"
    elif wants_serp:
        mode = "serp"
    else:
        mode = "volume"

    quoted = re.findall(r'"([^"]+)"|\'([^\']+)\'', message)
    keywords = [a or b for a, b in quoted if (a or b).strip()]
    if not keywords:
        # líneas o fragmentos tras dos puntos
        for part in re.split(r"[,;\n]", message):
            p = part.strip()
            if 2 < len(p) < 120 and not p.lower().startswith(
                ("dame", "muéstrame", "muestrame", "quiero", "para")
            ):
                keywords.append(p[:200])
    keywords = _normalize_keywords(keywords, max_count=MAX_VOLUME_KEYWORDS)
    return mode, keywords


def _format_answer_markdown(
    *,
    defaults: SeoDefaults,
    mode: SeoMode,
    keywords: list[str],
    volume_results: list[dict[str, Any]],
    serp_results: list[dict[str, Any]],
) -> str:
    loc = defaults["location_code"]
    lang = defaults["language_code"]
    depth = defaults["serp_depth"]
    lines: list[str] = [
        "## Configuración usada",
        "",
        (
            f"**Configuración usada:** location_code={loc}, language_code={lang}, "
            f"SERP=advanced, depth={depth}, keywords_procesadas={len(keywords)}, modo={mode}."
        ),
        "",
    ]

    if mode in ("volume", "both") and volume_results:
        lines.extend(["## Volumen de búsqueda", ""])
        lines.append("| Keyword | Volumen mensual |")
        lines.append("| --- | ---: |")
        for row in volume_results:
            kw = str(row.get("keyword") or "")
            sv = row.get("search_volume")
            sv_s = "—" if sv is None else str(sv)
            lines.append(f"| {kw} | {sv_s} |")
        lines.append("")
        lines.append(
            "_Los volúmenes son estimaciones de DataForSEO/Google Ads y pueden variar._"
        )
        lines.append("")

    if mode in ("serp", "both") and serp_results:
        lines.extend(["## SERP (resultados orgánicos)", ""])
        for block in serp_results:
            kw = str(block.get("keyword") or "")
            lines.append(f"### {kw}")
            dt = block.get("datetime")
            if dt:
                lines.append(f"_Captura: {dt}_")
            organic = block.get("organic_results") or []
            if not organic:
                lines.append("- Sin resultados orgánicos en la respuesta.")
            else:
                for r in organic:
                    pos = r.get("position")
                    title = r.get("title") or "(sin título)"
                    url = r.get("url") or ""
                    lines.append(f"- **{pos}.** {title}" + (f" — {url}" if url else ""))
            lines.append("")
        lines.append(
            "_SERP: snapshot del momento (Google Organic live/advanced); no es histórico._"
        )

    if mode in ("volume", "both") and keywords and not volume_results:
        lines.extend(
            [
                "## Volumen de búsqueda",
                "",
                "DataForSEO no devolvió datos para las keywords indicadas "
                "(Google Ads a veces no reporta volumen para ciertas consultas o mercados).",
                "",
            ]
        )

    if not volume_results and not serp_results:
        lines.append(
            "No se obtuvieron resultados. Revisá las keywords o la configuración DataForSEO."
        )

    return "\n".join(lines).strip()


def build_seo_graph(
    client: Client,
    run_id: str,
    *,
    gemini_api_key: str,
    chat_model: str,
    dataforseo_login: str,
    dataforseo_password: str,
    seo_defaults: SeoDefaults,
    langsmith_parent: Any | None = None,
) -> Any:
    step_idx = [0]

    def _next_step_index() -> int:
        step_idx[0] += 1
        return step_idx[0]

    def parse_request(state: SeoGraphState) -> dict[str, Any]:
        with traced_graph_node(
            langsmith_parent,
            name="seo.parse_request",
            inputs={"message_preview": (state.get("message") or "")[:500]},
        ) as (_, holder):
            mode, keywords = parse_seo_request_with_gemini(
                str(state.get("message") or ""),
                api_key=gemini_api_key,
                model=chat_model,
            )
            holder["outputs"] = {"mode": mode, "keyword_count": len(keywords)}
        return {"mode": mode, "keywords": keywords}

    def run_volume_and_serp(state: SeoGraphState) -> dict[str, Any]:
        mode = state.get("mode") or "volume"
        keywords = list(state.get("keywords") or [])
        defaults = state.get("seo_defaults") or seo_defaults
        loc = int(defaults["location_code"])
        lang = str(defaults["language_code"])
        depth = int(defaults["serp_depth"])

        volume_results: list[dict[str, Any]] = []
        serp_results: list[dict[str, Any]] = []

        with traced_graph_node(
            langsmith_parent,
            name="seo.run_volume_and_serp",
            inputs={"mode": mode, "keywords": keywords[:10]},
        ) as (_, holder):
            if mode in ("volume", "both") and keywords:
                vol_kws = keywords[:MAX_VOLUME_KEYWORDS]
                volume_results = fetch_search_volume_live(
                    dataforseo_login,
                    dataforseo_password,
                    vol_kws,
                    location_code=loc,
                    language_code=lang,
                )
            if mode in ("serp", "both") and keywords:
                serp_kws = keywords[:MAX_SERP_KEYWORDS]
                for kw in serp_kws:
                    serp_results.append(
                        fetch_serp_google_organic_advanced(
                            dataforseo_login,
                            dataforseo_password,
                            kw,
                            location_code=loc,
                            language_code=lang,
                            depth=depth,
                        )
                    )
            holder["outputs"] = {
                "volume_rows": len(volume_results),
                "serp_blocks": len(serp_results),
            }

        safe_insert_agent_step(
            client,
            run_id=run_id,
            step_key="retrieve",
            step_index=_next_step_index(),
            payload={
                "seo": True,
                "phase": "dataforseo",
                "mode": mode,
                "keywords": keywords[:20],
                "keyword_count": len(keywords),
                "location_code": loc,
                "language_code": lang,
                "serp_depth": depth,
                "volume_row_count": len(volume_results),
                "volume_summary": [
                    {
                        "keyword": r.get("keyword"),
                        "search_volume": r.get("search_volume"),
                    }
                    for r in volume_results[:50]
                ],
                "serp_block_count": len(serp_results),
                "serp_summary": [
                    {
                        "keyword": s.get("keyword"),
                        "top": [
                            {
                                "position": t.get("position"),
                                "title": (t.get("title") or "")[:120],
                                "url": (t.get("url") or "")[:200],
                            }
                            for t in (s.get("organic_results") or [])[:3]
                        ],
                    }
                    for s in serp_results[:10]
                ],
            },
        )

        return {"volume_results": volume_results, "serp_results": serp_results}

    def format_answer(state: SeoGraphState) -> dict[str, Any]:
        mode = state.get("mode") or "volume"
        keywords = list(state.get("keywords") or [])
        defaults = state.get("seo_defaults") or seo_defaults
        answer = _format_answer_markdown(
            defaults=defaults,
            mode=mode,
            keywords=keywords,
            volume_results=list(state.get("volume_results") or []),
            serp_results=list(state.get("serp_results") or []),
        )
        safe_insert_agent_step(
            client,
            run_id=run_id,
            step_key="generate",
            step_index=_next_step_index(),
            payload={
                "seo": True,
                "phase": "format",
                "answer_preview": answer[:2000],
                "mode": mode,
                "keyword_count": len(keywords),
            },
        )
        return {"answer": answer}

    graph = StateGraph(SeoGraphState)
    graph.add_node("parse_request", parse_request)
    graph.add_node("run_volume_and_serp", run_volume_and_serp)
    graph.add_node("format_answer", format_answer)
    graph.add_edge(START, "parse_request")
    graph.add_edge("parse_request", "run_volume_and_serp")
    graph.add_edge("run_volume_and_serp", "format_answer")
    graph.add_edge("format_answer", END)
    return graph.compile()
