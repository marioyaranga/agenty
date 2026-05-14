"""Registro append-only de `audit_events` vía cliente Supabase (service_role)."""

from __future__ import annotations

import json
from typing import Any

from supabase import Client


def record_audit(
    client: Client,
    *,
    tenant_id: str,
    actor_user_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    agent_run_id: str | None = None,
) -> None:
    """Inserta un evento de auditoría. Fallos se ignoran para no tumbar el flujo principal."""
    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "actor_user_id": actor_user_id,
        "event_type": event_type[:128],
        "payload": _sanitize_payload(payload or {}),
    }
    if agent_run_id:
        row["agent_run_id"] = agent_run_id
    try:
        client.table("audit_events").insert(row).execute()
    except Exception:  # noqa: BLE001
        pass


def _sanitize_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Evita cuerpos enormes o no serializables en JSON."""
    try:
        raw = json.dumps(data, default=str)[:16000]
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return {"_truncated": True}
