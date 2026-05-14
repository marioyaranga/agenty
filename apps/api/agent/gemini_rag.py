"""Generación de respuesta con Gemini usando contexto RAG (clave por tenant o env)."""

from __future__ import annotations

from typing import Any

from google import genai

from gemini_keys import resolve_gemini_api_key

# Modelo de chat equilibrado (calidad/latencia/costo); documentado en runbook Fase 5.
CHAT_MODEL = "gemini-2.0-flash"


def rewrite_query_for_retrieval(
    user_message: str,
    *,
    api_key: str | None = None,
) -> str:
    """Reescribe la pregunta en una consulta corta orientada a búsqueda semántica (español)."""
    base = (user_message or "").strip()
    if not base:
        return ""
    prompt = (
        "Convertí la siguiente pregunta de usuario en una sola línea de consulta de búsqueda "
        "para recuperación semántica sobre documentos (sin explicación, sin comillas, máximo 200 "
        "caracteres, español).\n\n"
        f"Pregunta:\n{base[:4000]}"
    )
    key = resolve_gemini_api_key(api_key=api_key)
    genai_client = genai.Client(api_key=key)
    resp = genai_client.models.generate_content(model=CHAT_MODEL, contents=prompt)
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    text = " ".join(text.split())
    if not text:
        return base[:400]
    return text[:400]


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


def answer_with_gemini(
    user_message: str,
    matches: list[dict[str, Any]],
    *,
    api_key: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
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

    key = resolve_gemini_api_key(api_key=api_key)
    genai_client = genai.Client(api_key=key)
    resp = genai_client.models.generate_content(model=CHAT_MODEL, contents=prompt)
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    if not text:
        text = "No se pudo obtener texto del modelo."
    return text, cites
