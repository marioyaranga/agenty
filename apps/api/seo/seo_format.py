"""Formateo de resultados SEO a Markdown para la UI del agente."""

from __future__ import annotations

from typing import Any, Literal

from seo.seo_keys import SeoDefaults

SeoMode = Literal["volume", "serp", "both"]


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
