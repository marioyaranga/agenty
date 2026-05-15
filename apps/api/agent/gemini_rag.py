"""Generación de respuesta con Gemini usando contexto RAG (clave por tenant o env).

Fase 10: `answer_with_gemini_with_tools` añade soporte de function calling.
"""

from __future__ import annotations

from typing import Any

from google import genai
from google.genai import types as genai_types

from agent_chat_models import DEFAULT_AGENT_CHAT_MODEL
from gemini_keys import resolve_gemini_api_key


def rewrite_query_for_retrieval(
    user_message: str,
    *,
    api_key: str | None = None,
    model: str | None = None,
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
    mid = (model or "").strip() or DEFAULT_AGENT_CHAT_MODEL
    key = resolve_gemini_api_key(api_key=api_key)
    genai_client = genai.Client(api_key=key)
    resp = genai_client.models.generate_content(model=mid, contents=prompt)
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
    model: str | None = None,
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

    mid = (model or "").strip() or DEFAULT_AGENT_CHAT_MODEL
    key = resolve_gemini_api_key(api_key=api_key)
    genai_client = genai.Client(api_key=key)
    resp = genai_client.models.generate_content(model=mid, contents=prompt)
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    if not text:
        text = "No se pudo obtener texto del modelo."
    return text, cites


def _build_tools_config(
    tool_declarations: list[dict[str, Any]],
) -> list[genai_types.Tool]:
    """Construye la lista de `types.Tool` para pasar a generate_content."""
    fn_decls = []
    for decl in tool_declarations:
        try:
            fn_decls.append(genai_types.FunctionDeclaration(**decl))
        except Exception:  # noqa: BLE001
            pass
    if not fn_decls:
        return []
    return [genai_types.Tool(function_declarations=fn_decls)]


def answer_with_gemini_with_tools(
    user_message: str,
    matches: list[dict[str, Any]],
    *,
    tool_results: list[dict[str, Any]] | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Genera respuesta con soporte de function calling de Gemini.

    Retorna un dict con:
    - {"text": ..., "citations": ...}  si el modelo respondió con texto.
    - {"tool_name": ..., "tool_args": ...}  si el modelo emitió una tool call.
    """
    from agent.tools import GEMINI_TOOL_DECLARATIONS  # import local para evitar circular

    cites = citations_from_matches(matches)

    context_lines = []
    if matches:
        context_lines.append(f"<<<CONTEXT>>>\n{_format_context(matches)}\n<<</CONTEXT>>>")

    tool_history = ""
    for tr in tool_results or []:
        tname = tr.get("tool_name", "")
        result = tr.get("result", {})
        if result.get("ok"):
            tool_history += f"\n[Tool {tname} ejecutada con éxito: {result}]"
        else:
            tool_history += f"\n[Tool {tname} falló: {result.get('error', 'desconocido')}]"

    system_prompt = (
        "Sos un asistente inteligente en español. Podés responder preguntas usando el "
        "contexto RAG disponible y también podés usar tools para crear, editar, mover o "
        "eliminar archivos y carpetas del espacio de trabajo del usuario. "
        "Si el usuario te pide hacer algo sobre archivos, usá las tools disponibles. "
        "Si el contexto RAG no alcanza para responder, decilo con claridad."
    )
    parts = [system_prompt]
    if context_lines:
        parts.extend(context_lines)
    if tool_history:
        parts.append(f"Historial de tools ejecutadas:{tool_history}")
    parts.append(f"Pregunta del usuario:\n{user_message.strip()}")
    prompt = "\n\n".join(parts)

    mid = (model or "").strip() or DEFAULT_AGENT_CHAT_MODEL
    key = resolve_gemini_api_key(api_key=api_key)
    genai_client = genai.Client(api_key=key)

    tools = _build_tools_config(GEMINI_TOOL_DECLARATIONS)
    config = genai_types.GenerateContentConfig(tools=tools) if tools else None

    try:
        if config:
            resp = genai_client.models.generate_content(
                model=mid, contents=prompt, config=config
            )
        else:
            resp = genai_client.models.generate_content(model=mid, contents=prompt)
    except Exception as exc:  # noqa: BLE001
        return {"text": f"Error al llamar al modelo: {exc}", "citations": []}

    # Detectar function call en la respuesta.
    candidates = getattr(resp, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", []) or []:
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", None):
                args = {}
                raw_args = getattr(fc, "args", None)
                if raw_args:
                    try:
                        args = dict(raw_args)
                    except Exception:  # noqa: BLE001
                        args = {}
                return {"tool_name": fc.name, "tool_args": args}

    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    if not text:
        text = "No se pudo obtener texto del modelo."
    return {"text": text, "citations": cites}
