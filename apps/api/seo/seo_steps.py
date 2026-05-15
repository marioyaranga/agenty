"""Formateo de `agent_steps` SEO para la UI (subagentes visibles)."""

from __future__ import annotations

from typing import Any

PHASE_LABELS: dict[str, tuple[str, str]] = {
    "dataforseo": (
        "DataForSEO",
        "Consultas a volumen y/o SERP según el modo.",
    ),
    "parse": (
        "Orquestador",
        "Interpreta el mensaje y extrae modo (volumen / SERP) y keywords.",
    ),
    "volume": (
        "Volumen de búsqueda",
        "Consulta DataForSEO (Google Ads search volume).",
    ),
    "serp": (
        "SERP orgánico",
        "Consulta resultados orgánicos en Google (live advanced).",
    ),
    "keywords_for_url": (
        "Keywords por URL",
        "Obtiene las keywords asociadas a un dominio o página (Google Ads).",
    ),
    "format": (
        "Respuesta",
        "Arma tablas y resumen en Markdown.",
    ),
}


def _phase_from_payload(payload: dict[str, Any], step_key: str) -> str:
    if step_key == "generate":
        return "format"
    phase = str(payload.get("phase") or "").strip().lower()
    if phase == "dataforseo":
        return "dataforseo"
    if phase in PHASE_LABELS:
        return phase
    # Compat: pasos SEO antiguos sin `phase` en retrieve
    if payload.get("seo") and step_key == "retrieve":
        if payload.get("volume_summary") is not None or payload.get("serp_summary") is not None:
            mode = str(payload.get("mode") or "volume")
            if mode == "both":
                return "volume"
            return "serp" if mode == "serp" else "volume"
    return "parse"


def _detail_for_phase(phase: str, payload: dict[str, Any]) -> str:
    if phase == "parse":
        mode = str(payload.get("mode") or "—")
        kws = payload.get("keywords") or []
        preview = ", ".join(str(k) for k in kws[:5])
        extra = f" (+{len(kws) - 5} más)" if len(kws) > 5 else ""
        return f"Modo: {mode}. Keywords: {preview}{extra}" if preview else f"Modo: {mode}."
    if phase == "volume":
        rows = payload.get("volume_summary") or payload.get("rows") or []
        n = len(rows) if isinstance(rows, list) else int(payload.get("row_count") or 0)
        return f"{n} keyword(s) con volumen."
    if phase == "serp":
        blocks = payload.get("serp_summary") or payload.get("blocks") or []
        n = len(blocks) if isinstance(blocks, list) else int(payload.get("block_count") or 0)
        return f"{n} SERP consultada(s)."
    if phase == "keywords_for_url":
        target = str(payload.get("target_url") or "")
        n = int(payload.get("keyword_count") or 0)
        return f"{n} keyword(s) para {target}." if target else f"{n} keyword(s)."
    if phase == "format":
        n = int(payload.get("keyword_count") or 0)
        mode = str(payload.get("mode") or "")
        return f"Respuesta lista ({mode or 'ok'}, {n} keywords)." if n else "Respuesta lista."
    return ""


def format_seo_steps_for_ui(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convierte filas `agent_steps` en lista ordenada para el cliente."""
    seo_rows = [r for r in rows if (r.get("payload") or {}).get("seo")]
    seo_rows.sort(key=lambda r: int(r.get("step_index") or 0))

    out: list[dict[str, Any]] = []
    seen_phases: set[str] = set()

    for row in seo_rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        step_key = str(row.get("step_key") or "")
        phase = _phase_from_payload(payload, step_key)
        if phase == "dataforseo":
            mode = str(payload.get("mode") or "volume")
            sub_phases: list[str] = []
            if mode in ("volume", "both") and (
                payload.get("volume_summary") or payload.get("volume_row_count")
            ):
                sub_phases.append("volume")
            if mode in ("serp", "both") and (
                payload.get("serp_summary") or payload.get("serp_block_count")
            ):
                sub_phases.append("serp")
            if mode == "keywords_for_url" and (
                payload.get("keywords_summary") or payload.get("keyword_count")
            ):
                sub_phases.append("keywords_for_url")
            for sub in sub_phases:
                if sub in seen_phases:
                    continue
                seen_phases.add(sub)
                label, description = PHASE_LABELS[sub]
                out.append(
                    {
                        "id": sub,
                        "label": label,
                        "description": description,
                        "status": "completed",
                        "detail": _detail_for_phase(sub, payload),
                        "step_index": int(row.get("step_index") or 0),
                    }
                )
            continue
        if phase in seen_phases:
            continue
        seen_phases.add(phase)
        label, description = PHASE_LABELS.get(phase, (phase, ""))
        out.append(
            {
                "id": phase,
                "label": label,
                "description": description,
                "status": "completed",
                "detail": _detail_for_phase(phase, payload),
                "step_index": int(row.get("step_index") or 0),
            }
        )

    return out


def placeholder_steps_for_mode(mode: str) -> list[dict[str, Any]]:
    """Pasos esperados mientras corre el run (progreso simulado en UI)."""
    phases: list[str] = ["parse"]
    if mode in ("volume", "both"):
        phases.append("volume")
    if mode in ("serp", "both"):
        phases.append("serp")
    phases.append("format")

    out: list[dict[str, Any]] = []
    for i, phase in enumerate(phases):
        label, description = PHASE_LABELS[phase]
        out.append(
            {
                "id": phase,
                "label": label,
                "description": description,
                "status": "running" if i == 0 else "pending",
                "detail": None,
                "step_index": i + 1,
            }
        )
    return out
