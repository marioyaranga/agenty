"""Formateo unificado de `agent_steps` para la UI del chat (grafo, tools, SEO)."""

from __future__ import annotations

from typing import Any

from seo.seo_steps import format_seo_steps_for_ui

# Nodos LangGraph (no tool_*)
GRAPH_LABELS: dict[str, tuple[str, str]] = {
    "retrieve": (
        "Búsqueda en documentos",
        "Búsqueda semántica en tu base de conocimiento.",
    ),
    "rewrite_query": (
        "Refinando la consulta",
        "Mejorando la consulta para obtener mejores resultados.",
    ),
    "generate": (
        "Generando respuesta",
        "Analizando el contexto y redactando la respuesta.",
    ),
    "respond_no_context": (
        "Respuesta directa",
        "Redactando la respuesta sin contexto recuperado.",
    ),
    "execute_tool": (
        "Ejecutando herramienta",
        "Realizando una acción en tu espacio de trabajo.",
    ),
}

TOOL_LABELS: dict[str, tuple[str, str]] = {
    "tool_create_folder": ("Crear carpeta", "Crea una carpeta en el espacio de trabajo."),
    "tool_create_document": ("Crear documento", "Crea un documento Markdown nuevo."),
    "tool_update_document_content": (
        "Actualizar documento",
        "Modifica el contenido de un documento existente.",
    ),
    "tool_rename": ("Renombrar", "Cambia el nombre de un archivo o carpeta."),
    "tool_move": ("Mover", "Mueve un archivo o carpeta a otra ubicación."),
    "tool_delete_document": ("Eliminar documento", "Borra un documento del espacio."),
    "tool_delete_folder": ("Eliminar carpeta", "Borra una carpeta y su contenido."),
    "tool_list_folder": ("Listar carpeta", "Lista archivos y subcarpetas."),
    "tool_read_document": ("Leer documento", "Obtiene metadatos del documento (sin volcar el cuerpo)."),
    "tool_search_documents": (
        "Buscar documentos",
        "Búsqueda por título o contenido en el espacio.",
    ),
    "tool_seo_search_volume": (
        "Volumen de búsqueda",
        "Consulta volumen mensual vía DataForSEO.",
    ),
    "tool_seo_serp_organic": (
        "SERP orgánico",
        "Consulta resultados orgánicos en Google.",
    ),
    "tool_seo_ranked_keywords_for_url": (
        "Rankings por URL",
        "Keywords orgánicas y posición para una página (DataForSEO Labs).",
    ),
    "tool_seo_keywords_for_url": (
        "Rankings por URL",
        "Keywords orgánicas y posición para una página (DataForSEO Labs).",
    ),
}

_SENSITIVE_KEYS = frozenset({
    "body",
    "content",
    "raw",
    "markdown",
    "document_body",
    "api_key",
    "gemini_api_key",
    "encrypted",
    "matches",
    "snippet",
    "snippets",
})


def tool_label_description(tool_name: str) -> tuple[str, str]:
    """Label y descripción en español para una tool por nombre."""
    if tool_name in TOOL_LABELS:
        return TOOL_LABELS[tool_name]
    human = tool_name.removeprefix("tool_").replace("_", " ").strip() or tool_name
    return (human.capitalize(), "Herramienta del agente.")


def _is_tool_step_key(step_key: str) -> bool:
    return step_key.startswith("tool_")


def _ui_detail_from_payload(step_key: str, payload: dict[str, Any]) -> str:
    """Resumen corto y seguro para la UI (sin cuerpos de documentos ni secretos)."""
    if not payload:
        return ""

    if payload.get("seo"):
        return ""

    tool_call = payload.get("tool_call")
    if tool_call and step_key == "generate":
        lbl, _ = tool_label_description(str(tool_call))
        return f"Solicitó: {lbl}."

    if _is_tool_step_key(step_key) or payload.get("tool_name"):
        ok = payload.get("ok")
        if ok is False:
            err = str(payload.get("error") or "Error")[:200]
            return f"Error: {err}" if err else "Error en la herramienta."
        parts: list[str] = []
        if payload.get("title"):
            parts.append(f"«{str(payload['title'])[:120]}»")
        if payload.get("name"):
            parts.append(f"«{str(payload['name'])[:120]}»")
        if payload.get("new_name"):
            parts.append(f"→ {str(payload['new_name'])[:120]}")
        if payload.get("document_id"):
            parts.append(f"doc {str(payload['document_id'])[:36]}")
        if payload.get("folder_id"):
            parts.append(f"carpeta {str(payload['folder_id'])[:36]}")
        if payload.get("item_count") is not None:
            parts.append(f"{payload['item_count']} elemento(s)")
        if payload.get("match_count") is not None:
            parts.append(f"{payload['match_count']} coincidencia(s)")
        if payload.get("keyword_count") is not None:
            parts.append(f"{payload['keyword_count']} keyword(s)")
        if payload.get("row_count") is not None:
            parts.append(f"{payload['row_count']} fila(s)")
        if ok is True and not parts:
            return "Completado."
        return ". ".join(parts)[:400] if parts else ("Completado." if ok else "")

    if step_key == "retrieve":
        matches = payload.get("matches")
        if isinstance(matches, list):
            n = len(matches)
            best = max((float(m.get("similarity") or 0) for m in matches if isinstance(m, dict)), default=0.0)
            return f"{n} fragmento(s); mejor similitud {best:.2f}."
        return "Búsqueda completada."

    if step_key == "rewrite_query":
        q = str(payload.get("effective_query_preview") or payload.get("query_preview") or "")
        return f"Nueva consulta: {q[:200]}…" if len(q) > 200 else (f"Nueva consulta: {q}" if q else "")

    if step_key == "generate":
        cites = payload.get("citations_count")
        if cites is not None:
            return f"Respuesta con {cites} cita(s)."
        return "Respuesta generada."

    if step_key == "respond_no_context":
        return "Sin contexto RAG suficiente."

    safe_bits: list[str] = []
    for k, v in payload.items():
        if k in _SENSITIVE_KEYS:
            continue
        if isinstance(v, (dict, list)):
            continue
        s = str(v).strip()
        if s and len(s) <= 120:
            safe_bits.append(f"{k}: {s}")
        if len(safe_bits) >= 4:
            break
    return "; ".join(safe_bits)[:400]


def _graph_step_row(row: dict[str, Any]) -> dict[str, Any] | None:
    step_key = str(row.get("step_key") or "")
    payload = row.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}

    if payload.get("seo"):
        return None

    if _is_tool_step_key(step_key):
        tool_name = str(payload.get("tool_name") or step_key)
        label, description = tool_label_description(tool_name)
        return {
            "id": f"{row.get('step_index')}-{step_key}",
            "kind": "tool",
            "label": label,
            "description": description,
            "status": "completed",
            "detail": _ui_detail_from_payload(step_key, payload) or None,
            "step_index": int(row.get("step_index") or 0),
            "tool_name": tool_name,
        }

    if step_key == "generate" and payload.get("tool_call") and not payload.get("citations_count"):
        return None

    label, description = GRAPH_LABELS.get(
        step_key,
        (step_key.replace("_", " ").capitalize(), ""),
    )
    return {
        "id": f"{row.get('step_index')}-{step_key}",
        "kind": "graph",
        "label": label,
        "description": description,
        "status": "completed",
        "detail": _ui_detail_from_payload(step_key, payload) or None,
        "step_index": int(row.get("step_index") or 0),
    }


def tool_detail_from_result(tool_name: str, result: dict[str, Any]) -> str:
    """Resumen compacto para eventos SSE `tool` done."""
    payload = {"tool_name": tool_name, **{k: v for k, v in result.items() if k != "result"}}
    if isinstance(result.get("result"), dict):
        inner = result["result"]
        if isinstance(inner, dict):
            payload.update({k: v for k, v in inner.items() if k not in _SENSITIVE_KEYS})
    return _ui_detail_from_payload(tool_name, payload)


def format_agent_steps_for_ui(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convierte filas `agent_steps` en lista ordenada y segura para el cliente."""
    ordered = sorted(rows, key=lambda r: int(r.get("step_index") or 0))

    graph_and_tool: list[dict[str, Any]] = []
    for row in ordered:
        item = _graph_step_row(row)
        if item:
            graph_and_tool.append(item)

    seo_steps = format_seo_steps_for_ui(ordered)
    for s in seo_steps:
        s["kind"] = "seo"
        if "tool_name" not in s:
            s["tool_name"] = None

    merged = graph_and_tool + seo_steps
    merged.sort(key=lambda s: int(s.get("step_index") or 0))
    return merged
