"""Embeddings con Gemini (`gemini-embedding-001`) y dimensionalidad fija 1536."""

from __future__ import annotations

from collections.abc import Sequence

from google import genai
from google.genai import types
from supabase import Client

from gemini_keys import resolve_gemini_api_key

MODEL = "gemini-embedding-001"
EXPECTED_DIM = 1536


def embed_texts(
    texts: Sequence[str],
    *,
    api_key: str | None = None,
    client: Client | None = None,
    tenant_id: str | None = None,
) -> list[list[float]]:
    """Devuelve un vector por cada texto; valida longitud EXACTA.

    Clave Gemini: `api_key` explícita, o `client` + `tenant_id` (tabla cifrada + fallback env),
    o solo `GEMINI_API_KEY` si no se pasa tenant.
    """
    items = [t for t in texts]
    if not items:
        return []

    key = resolve_gemini_api_key(api_key=api_key, client=client, tenant_id=tenant_id)
    genai_client = genai.Client(api_key=key)
    resp = genai_client.models.embed_content(
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
