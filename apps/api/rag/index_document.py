"""Indexación síncrona (S1): Storage → chunks Markdown → embeddings → pgvector.

Re-embeddéo incremental: solo se vuelven a embeddear los chunks cuyo contenido cambió
(detectado por SHA-256 del body). Los chunks sin cambios reusan el embedding existente.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from storage3.exceptions import StorageApiError
from supabase import Client

from rag.chunk_markdown import chunk_markdown
from rag.embeddings import embed_texts

BUCKET_ID = "tenant_documents"

# Heurística conservadora (español): evita superar de forma grosera ventanas del modelo.
_MAX_ROUGH_TOKENS = 2048
_MARKDOWN_MIMES = frozenset({"text/markdown", "text/x-markdown"})


def _rough_token_estimate(text: str) -> int:
    stripped = (text or "").strip()
    if not stripped:
        return 0
    return max(1, len(stripped) // 3)


def _normalize_mime(mime: str) -> str:
    return (mime or "").split(";", 1)[0].strip().lower()


def is_real_markdown(mime: str) -> bool:
    return _normalize_mime(mime) in _MARKDOWN_MIMES


def sync_index_markdown_document(
    client: Client,
    *,
    tenant_id: str,
    document_id: str,
    storage_path: str,
    mime_type: str,
) -> tuple[str, str | None]:
    """Indexa un documento Markdown pendiente. Devuelve (index_status, index_error)."""
    if not is_real_markdown(mime_type):
        return "ready", None

    storage = client.storage.from_(BUCKET_ID)
    try:
        raw = storage.download(storage_path)
    except StorageApiError as exc:
        return "failed", f"No se pudo descargar desde Storage: {exc}"

    if not isinstance(raw, (bytes, bytearray)):
        return "failed", "Respuesta de Storage inesperada al indexar"

    try:
        text = bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        return "failed", "El archivo no es UTF-8 válido; convertilo a UTF-8 antes de indexar."

    drafts = chunk_markdown(text)
    if not drafts:
        try:
            client.table("document_chunks").delete().eq("document_id", document_id).execute()
        except Exception as exc:  # noqa: BLE001
            return "failed", f"No se pudieron limpiar chunks previos: {exc}"
        return "ready", None

    for d in drafts:
        if _rough_token_estimate(d.body) > _MAX_ROUGH_TOKENS:
            return (
                "failed",
                "Un fragmento supera el límite heurístico de tokens para embedding "
                f"({_MAX_ROUGH_TOKENS}). Reducí el tamaño de la sección o dividí el contenido.",
            )

    # Diff incremental: leer embeddings existentes indexados por body_hash
    existing_by_hash: dict[str, list[float]] = {}
    try:
        ex_res = (
            client.table("document_chunks")
            .select("body_hash, embedding")
            .eq("document_id", document_id)
            .execute()
        )
        for row in ex_res.data or []:
            bh = row.get("body_hash")
            emb = row.get("embedding")
            if bh and emb:
                existing_by_hash[bh] = list(emb)
    except Exception:  # noqa: BLE001 — si falla, cae al camino completo
        existing_by_hash = {}

    new_hashes = [hashlib.sha256(d.body.encode()).hexdigest() for d in drafts]
    need_embed_indices = [i for i, h in enumerate(new_hashes) if h not in existing_by_hash]

    if need_embed_indices:
        bodies_to_embed = [drafts[i].body for i in need_embed_indices]
        try:
            new_vectors = embed_texts(bodies_to_embed, client=client, tenant_id=tenant_id)
        except Exception as exc:  # noqa: BLE001
            return "failed", f"Fallo al generar embeddings: {exc}"
        if len(new_vectors) != len(bodies_to_embed):
            return "failed", "Cantidad de embeddings distinta a la de fragmentos."
        for idx, vec in zip(need_embed_indices, new_vectors):
            existing_by_hash[new_hashes[idx]] = vec

    try:
        client.table("document_chunks").delete().eq("document_id", document_id).execute()
    except Exception as exc:  # noqa: BLE001
        return "failed", f"No se pudieron eliminar chunks previos: {exc}"

    rows: list[dict[str, Any]] = []
    for idx, (draft, h) in enumerate(zip(drafts, new_hashes)):
        rows.append(
            {
                "tenant_id": tenant_id,
                "document_id": document_id,
                "chunk_index": idx,
                "heading_path": draft.heading_path,
                "body": draft.body,
                "body_hash": h,
                "embedding": existing_by_hash[h],
                "token_count": _rough_token_estimate(draft.body),
            }
        )

    batch = 80
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        try:
            client.table("document_chunks").insert(chunk).execute()
        except Exception as exc:  # noqa: BLE001
            return "failed", f"No se pudieron insertar chunks: {exc}"

    return "ready", None


def truncate_index_error(message: str | None, limit: int = 1800) -> str | None:
    if message is None:
        return None
    msg = re.sub(r"\s+", " ", str(message)).strip()
    if len(msg) <= limit:
        return msg
    return msg[: limit - 1] + "…"
