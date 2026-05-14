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
) -> None:
    row: dict[str, Any] = {
        "id": run_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "status": "running",
        "input_message": input_message[:12000],
    }
    client.table("agent_runs").insert(row).execute()


def insert_agent_step(
    client: Client,
    *,
    run_id: str,
    step_key: str,
    step_index: int,
    payload: dict[str, Any],
) -> None:
    client.table("agent_steps").insert(
        {
            "run_id": run_id,
            "step_key": step_key,
            "step_index": step_index,
            "payload": payload,
        }
    ).execute()


def finalize_agent_run(
    client: Client,
    *,
    run_id: str,
    status: str,
    output_message: str | None = None,
    error: str | None = None,
    langsmith_trace_id: str | None = None,
) -> None:
    fields: dict[str, Any] = {"status": status}
    if output_message is not None:
        fields["output_message"] = output_message[:24000]
    if error is not None:
        fields["error"] = error[:8000]
    if langsmith_trace_id:
        fields["langsmith_trace_id"] = langsmith_trace_id[:256]
    client.table("agent_runs").update(fields).eq("id", run_id).execute()
