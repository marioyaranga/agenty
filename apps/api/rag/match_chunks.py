"""Recuperación semántica sobre `document_chunks` (embedding + RPC `match_document_chunks`)."""

from __future__ import annotations

import hashlib
from typing import Any

from supabase import Client

from rag.embeddings import embed_texts


def _get_or_embed(client: Client, query: str, *, api_key: str | None) -> list[float]:
    """Devuelve el embedding de la query, con cache en query_embedding_cache."""
    q_hash = hashlib.sha256(query.encode()).hexdigest()
    try:
        hit = client.table("query_embedding_cache").select("embedding").eq("query_hash", q_hash).limit(1).execute()
        rows = hit.data or []
        if rows:
            return list(rows[0]["embedding"])
    except Exception:  # noqa: BLE001
        pass

    vec = embed_texts([query], api_key=api_key, client=client)[0]

    try:
        client.table("query_embedding_cache").upsert(
            {"query_hash": q_hash, "embedding": vec}, on_conflict="query_hash"
        ).execute()
    except Exception:  # noqa: BLE001
        pass

    return vec


def match_document_chunks(
    client: Client,
    *,
    tenant_id: str,
    query: str,
    match_count: int = 8,
    min_similarity: float = 0.25,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    """Devuelve filas del RPC `match_document_chunks` (chunk_id, document_id, heading_path, body, similarity)."""
    vec = _get_or_embed(client, query, api_key=api_key)
    match_count = max(1, min(int(match_count), 200))
    min_similarity = max(0.0, min(float(min_similarity), 1.0))
    rpc = client.rpc(
        "match_document_chunks",
        {
            "p_tenant_id": tenant_id,
            "p_query_embedding": vec,
            "p_match_count": match_count,
            "p_min_similarity": min_similarity,
        },
    ).execute()
    return list(rpc.data or [])
