"""Chunking por encabezados Markdown (ruta jerárquica + cuerpo).

Divide secciones demasiado grandes por párrafos para respetar límites prácticos
del modelo de embedding sin silenciar el fallo (la capa superior valida tamaño).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


@dataclass(frozen=True)
class MarkdownChunkDraft:
    """Fragmento listo para embedding (índice asignado después)."""

    heading_path: str
    body: str


def _split_oversized_body(body: str, max_chars: int) -> list[str]:
    text = body.strip()
    if len(text) <= max_chars:
        return [text] if text else []

    parts: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for para in re.split(r"\n\s*\n", text):
        p = para.strip()
        if not p:
            continue
        add_len = len(p) if not buf else len(p) + 2
        if buf and buf_len + add_len > max_chars:
            joined = "\n\n".join(buf).strip()
            if joined:
                parts.append(joined)
            buf = [p]
            buf_len = len(p)
            continue
        buf.append(p)
        buf_len += add_len
    if buf:
        joined = "\n\n".join(buf).strip()
        if joined:
            parts.append(joined)
    return parts


def chunk_markdown(markdown: str, *, max_chars_per_chunk: int = 9000) -> list[MarkdownChunkDraft]:
    """Genera borradores de chunks a partir de Markdown plano."""
    text = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    stack: list[tuple[int, str]] = []
    current: list[str] = []
    out: list[MarkdownChunkDraft] = []

    def heading_path() -> str:
        return " > ".join(t for _, t in stack)

    def flush_current() -> None:
        body = "\n".join(current).strip()
        if not body:
            return
        hp = heading_path()
        for piece in _split_oversized_body(body, max_chars_per_chunk):
            if piece:
                out.append(MarkdownChunkDraft(heading_path=hp, body=piece))

    for line in lines:
        m = _HEADING.match(line)
        if m:
            flush_current()
            level = len(m.group(1))
            title = m.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            current = []
            continue
        current.append(line)

    flush_current()
    return out
