"""Generación de respuesta con Gemini usando contexto RAG (misma `GEMINI_API_KEY` que embeddings)."""

from __future__ import annotations

import os
from typing import Any

from google import genai

# Modelo de chat equilibrado (calidad/latencia/costo); documentado en runbook Fase 5.
CHAT_MODEL = "gemini-2.0-flash"


def _client() -> genai.Client:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY no configurada")
    return genai.Client(api_key=key)


def citations_from_matches(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in matches:
        out.append(
            {
                "chunk_id": str(m.get("chunk_id", "")),
                "document_id": str(m.get("document_id", "")),
                "heading_path": str(m.get("heading_path") or ""),
                "similarity": float(m.get("similarity") or 0.0),
            }
        )
    return out


def _format_context(matches: list[dict[str, Any]], max_chars: int = 12000) -> str:
    parts: list[str] = []
    used = 0
    for i, m in enumerate(matches, start=1):
        hp = str(m.get("heading_path") or "").strip()
        body = str(m.get("body") or "").strip()
        block = f"[{i}] (documento {m.get('document_id')}) {hp}\n{body}\n"
        if used + len(block) > max_chars:
            break
        parts.append(block)
        used += len(block)
    return "\n".join(parts).strip()


def answer_with_gemini(user_message: str, matches: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """Devuelve (texto_respuesta, citas alineadas a los chunks usados en el prompt)."""
    cites = citations_from_matches(matches)
    if not matches:
        return (
            "No hay fragmentos indexados con similitud suficiente en este espacio. "
            "Probá subir o indexar documentos Markdown.",
            [],
        )

    context = _format_context(matches)
    prompt = (
        "Sos un asistente que responde en español usando solo el contexto entre "
        "las líneas <<<CONTEXT>>> y <<</CONTEXT>>>. Si el contexto no alcanza, "
        "decilo con claridad. No inventes datos fuera del contexto.\n\n"
        f"<<<CONTEXT>>>\n{context}\n<<</CONTEXT>>>\n\n"
        f"Pregunta del usuario:\n{user_message.strip()}"
    )

    client = _client()
    resp = client.models.generate_content(model=CHAT_MODEL, contents=prompt)
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    if not text:
        text = "No se pudo obtener texto del modelo."
    return text, cites
