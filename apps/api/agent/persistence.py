"""Persistencia de `agent_runs` y `agent_steps` vía cliente Supabase (service_role)."""

from __future__ import annotations

import json
import logging
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)


def insert_agent_run(
    client: Client,
    *,
    run_id: str,
    tenant_id: str,
    user_id: str,
    input_message: str,
    thread_id: str | None = None,
) -> None:
    row: dict[str, Any] = {
        "id": run_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "status": "running",
        "input_message": input_message[:12000],
    }
    if thread_id is not None:
        row["thread_id"] = thread_id
    client.table("agent_runs").insert(row).execute()


def _compact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Evita payloads enormes en `agent_steps.payload` (límite práctico PostgREST)."""
    try:
        raw = json.dumps(payload, default=str)[:12000]
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return {"_truncated": True}


def insert_agent_step(
    client: Client,
    *,
    run_id: str,
    step_key: str,
    step_index: int,
    payload: dict[str, Any],
) -> None:
    """Inserta un paso; `step_index` debe ser único por `run_id` (Fase 7: UNIQUE run_id+step_index)."""
    client.table("agent_steps").insert(
        {
            "run_id": run_id,
            "step_key": step_key,
            "step_index": step_index,
            "payload": _compact_payload(payload),
        }
    ).execute()


def safe_insert_agent_step(
    client: Client,
    *,
    run_id: str,
    step_key: str,
    step_index: int,
    payload: dict[str, Any],
) -> None:
    """Inserta un paso sin tumbar el chat si PostgREST falla o va lento."""
    try:
        insert_agent_step(
            client,
            run_id=run_id,
            step_key=step_key,
            step_index=step_index,
            payload=payload,
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "safe_insert_agent_step falló (run_id=%s step_key=%s step_index=%s)",
            run_id,
            step_key,
            step_index,
        )


def list_agent_steps_for_run(client: Client, run_id: str) -> list[dict[str, Any]]:
    """Pasos de un run ordenados por `step_index` ascendente."""
    res = (
        client.table("agent_steps")
        .select("step_key, step_index, payload, created_at")
        .eq("run_id", run_id)
        .order("step_index", desc=False)
        .execute()
    )
    data = getattr(res, "data", None)
    return list(data) if isinstance(data, list) else []


def list_agent_steps_for_runs(client: Client, run_ids: list[str]) -> list[dict[str, Any]]:
    """Pasos de varios runs en una sola consulta, ordenados por run y step_index."""
    if not run_ids:
        return []
    res = (
        client.table("agent_steps")
        .select("run_id, step_key, step_index, payload, created_at")
        .in_("run_id", run_ids)
        .order("step_index", desc=False)
        .execute()
    )
    data = getattr(res, "data", None)
    return list(data) if isinstance(data, list) else []


def finalize_agent_run(
    client: Client,
    *,
    run_id: str,
    status: str,
    output_message: str | None = None,
    error: str | None = None,
    langsmith_trace_id: str | None = None,
    citations: list[Any] | None = None,
) -> None:
    fields: dict[str, Any] = {"status": status}
    if output_message is not None:
        fields["output_message"] = output_message[:24000]
    if error is not None:
        fields["error"] = error[:8000]
    if langsmith_trace_id:
        fields["langsmith_trace_id"] = langsmith_trace_id[:256]
    if citations is not None:
        fields["citations"] = [
            c if isinstance(c, dict) else (c.model_dump() if hasattr(c, "model_dump") else vars(c))
            for c in citations
        ]
    client.table("agent_runs").update(fields).eq("id", run_id).execute()
