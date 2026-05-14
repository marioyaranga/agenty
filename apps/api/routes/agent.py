"""Endpoint POST /v1/tenants/<tenant_id>/agent/chat (JWT + X-Tenant-Id + membresía).

Fase 8: al completar o fallar el run, se inserta notificación in-app para el usuario (`in_app_notifications`).
"""

from __future__ import annotations

import uuid
from typing import Any

from flask import Blueprint, jsonify, request

from agent.graph import build_agent_graph
from agent.persistence import finalize_agent_run, insert_agent_run
from agent.tracing import (
    finish_langsmith_root,
    langsmith_api_key_configured,
    optional_langsmith_root,
    trace_id_for_persistence,
)
from audit_log import record_audit
from gemini_keys import get_gemini_api_key_for_tenant
from notifications import notify_agent_chat_outcome
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("agent", __name__, url_prefix="/v1")


@bp.post("/tenants/<tenant_id>/agent/chat")
def agent_chat(tenant_id: str):
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return jsonify({"error": "Sin acceso a este espacio"}), 403

    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message es obligatorio"}), 400

    run_id = str(uuid.uuid4())
    ls_root: Any = None
    trace_id: str | None = None

    try:
        with optional_langsmith_root(
            name="workyai_agent_chat",
            inputs={"message": message[:2000], "tenant_id": tenant_id},
        ) as ls_rt:
            ls_root = ls_rt
            trace_id = trace_id_for_persistence(ls_root)

            insert_agent_run(
                client,
                run_id=run_id,
                tenant_id=tenant_id,
                user_id=user_id,
                input_message=message,
            )

            gemini_key = get_gemini_api_key_for_tenant(client, tenant_id)
            graph = build_agent_graph(
                client,
                run_id,
                gemini_api_key=gemini_key,
                langsmith_parent=ls_root,
            )
            final = graph.invoke({"tenant_id": tenant_id, "message": message})

            answer = str(final.get("answer") or "")
            citations = list(final.get("citations") or [])

            finalize_agent_run(
                client,
                run_id=run_id,
                status="completed",
                output_message=answer,
                langsmith_trace_id=trace_id,
            )

            record_audit(
                client,
                tenant_id=tenant_id,
                actor_user_id=user_id,
                event_type="agent.chat.completed",
                payload={
                    "run_id": run_id,
                    "message_preview": message[:400],
                    "answer_preview": answer[:400],
                    "citations_count": len(citations),
                },
                agent_run_id=run_id,
            )

            notify_agent_chat_outcome(
                client,
                tenant_id=tenant_id,
                user_id=user_id,
                run_id=run_id,
                completed=True,
            )

            finish_langsmith_root(
                ls_root,
                outputs={
                    "run_id": run_id,
                    "answer_preview": answer[:500],
                },
            )

        return (
            jsonify(
                {
                    "run_id": run_id,
                    "answer": answer,
                    "citations": citations,
                    "langsmith_trace_id": trace_id,
                    "langsmith_enabled": langsmith_api_key_configured(),
                }
            ),
            200,
        )
    except Exception as exc:  # noqa: BLE001
        err_s = str(exc)[:8000]
        try:
            finalize_agent_run(
                client,
                run_id=run_id,
                status="failed",
                error=err_s,
                langsmith_trace_id=trace_id,
            )
        except Exception:  # noqa: BLE001
            pass
        record_audit(
            client,
            tenant_id=tenant_id,
            actor_user_id=user_id,
            event_type="agent.chat.failed",
            payload={
                "run_id": run_id,
                "message_preview": message[:400],
                "detail_preview": err_s[:800],
            },
            agent_run_id=run_id,
        )
        notify_agent_chat_outcome(
            client,
            tenant_id=tenant_id,
            user_id=user_id,
            run_id=run_id,
            completed=False,
            detail=err_s,
        )
        finish_langsmith_root(ls_root, error=err_s)
        return (
            jsonify({"error": "Fallo del agente", "detail": err_s, "run_id": run_id}),
            502,
        )
