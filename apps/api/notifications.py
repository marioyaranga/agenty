"""Notificaciones in-app (Fase 8): inserción en `public.in_app_notifications` vía service_role.

Solo Flask (cliente admin) inserta filas; el front lee con JWT usuario y RLS.
Los fallos de inserción se registran y no interrumpen el flujo principal del API.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)

NOTIFICATION_KINDS = frozenset(
    {
        "document_index_ready",
        "document_index_failed",
        "agent_chat_completed",
        "agent_chat_failed",
    }
)


def insert_notification(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    kind: str,
    title: str,
    body: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Inserta una notificación; ante error solo loguea (no relanza)."""
    if kind not in NOTIFICATION_KINDS:
        logger.warning("insert_notification: kind no permitido %r", kind)
        return
    title_s = (title or "").strip()
    if not title_s:
        logger.warning("insert_notification: title vacío (kind=%s)", kind)
        return
    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "kind": kind,
        "title": title_s[:500],
        "body": (body[:4000] if body else None),
        "metadata": metadata or {},
    }
    try:
        client.table("in_app_notifications").insert(row).execute()
    except Exception:  # noqa: BLE001 — PostgREST/supabase genérico
        logger.exception(
            "insert_notification falló (kind=%s tenant=%s user=%s)",
            kind,
            tenant_id,
            user_id,
        )


def notify_document_index_outcome(
    client: Client,
    *,
    tenant_id: str,
    created_by: str | None,
    document_id: str,
    title: str,
    index_status: str,
    index_error: str | None = None,
) -> None:
    """Aviso MVP al creador del documento cuando la indexación termina ready/failed."""
    if not created_by:
        return
    if index_status == "ready":
        insert_notification(
            client,
            tenant_id=tenant_id,
            user_id=str(created_by),
            kind="document_index_ready",
            title="Documento indexado",
            body=f"«{title[:200]}» está listo para RAG.",
            metadata={
                "tenant_id": tenant_id,
                "document_id": document_id,
                "link": "documents",
            },
        )
    elif index_status == "failed":
        err = (index_error or "").strip()
        insert_notification(
            client,
            tenant_id=tenant_id,
            user_id=str(created_by),
            kind="document_index_failed",
            title="Falló la indexación",
            body=(err[:3500] if err else "Revisá el documento e intentá de nuevo."),
            metadata={
                "tenant_id": tenant_id,
                "document_id": document_id,
                "link": "documents",
            },
        )


def notify_agent_chat_outcome(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    run_id: str,
    completed: bool,
    detail: str | None = None,
) -> None:
    """Aviso al usuario del chat cuando el run termina ok o con error."""
    if completed:
        insert_notification(
            client,
            tenant_id=tenant_id,
            user_id=user_id,
            kind="agent_chat_completed",
            title="Respuesta del agente lista",
            body="Podés ver el resultado en el chat.",
            metadata={
                "tenant_id": tenant_id,
                "run_id": run_id,
                "link": "chat",
            },
        )
    else:
        d = (detail or "").strip()
        insert_notification(
            client,
            tenant_id=tenant_id,
            user_id=user_id,
            kind="agent_chat_failed",
            title="El agente falló",
            body=(d[:3500] if d else "Intentá de nuevo o revisá la configuración de IA."),
            metadata={
                "tenant_id": tenant_id,
                "run_id": run_id,
                "link": "chat",
            },
        )
