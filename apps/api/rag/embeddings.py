"""Embeddings con Gemini (`gemini-embedding-001`) y dimensionalidad fija 1536."""

from __future__ import annotations

import os
from collections.abc import Sequence

from google import genai
from google.genai import types

MODEL = "gemini-embedding-001"
EXPECTED_DIM = 1536


def _client() -> genai.Client:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY no configurada")
    return genai.Client(api_key=key)


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Devuelve un vector por cada texto; valida longitud EXACTA."""
    items = [t for t in texts]
    if not items:
        return []

    client = _client()
    resp = client.models.embed_content(
        model=MODEL,
        contents=items,
        config=types.EmbedContentConfig(output_dimensionality=EXPECTED_DIM),
    )
    embeddings = list(resp.embeddings or [])
    if len(embeddings) != len(items):
        raise RuntimeError(
            f"Respuesta de embeddings incompleta: {len(embeddings)} != {len(items)}"
        )

    out: list[list[float]] = []
    for emb in embeddings:
        values = list(emb.values or [])
        if len(values) != EXPECTED_DIM:
            raise RuntimeError(
                f"Dimensión de embedding inválida: {len(values)} (esperado {EXPECTED_DIM})"
            )
        out.append(values)
    return out
