"""Persistencia de `agent_runs` y `agent_steps` vía cliente Supabase (service_role)."""

from __future__ import annotations

from typing import Any

from supabase import Client


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
            "payload": payload,
        }
    ).execute()


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
