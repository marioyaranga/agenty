"""Endpoints de agente de chat y threads de conversación (JWT + X-Tenant-Id + membresía).

Fase 9: threads persistentes + citations en agent_runs.

Las consultas insert/update + ``select`` usan ``first_dict_from_execute`` porque
postgrest-py reciente ya no expone ``.single()`` en ese encadenamiento.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, current_app, jsonify, request

from agent.graph import build_agent_graph
from agent.persistence import finalize_agent_run, insert_agent_run
from agent_chat_models import get_agent_chat_model_for_tenant
from agent.tracing import (
    finish_langsmith_root,
    langsmith_api_key_configured,
    optional_langsmith_root,
    trace_id_for_persistence,
)
from audit_log import record_audit
from cursor import decode_cursor, encode_cursor
from gemini_keys import get_gemini_api_key_for_tenant
from notifications import notify_agent_chat_outcome
from postgrest_utils import first_dict_from_execute
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("agent", __name__, url_prefix="/v1")

# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _auth_common(tenant_id: str) -> tuple[str, str, Any, Any]:
    """Valida JWT + header + membresía. Devuelve (user_id, tenant_id, client, err)."""
    claims, err = require_bearer_jwt()
    if err:
        return "", "", None, err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return "", "", None, err
    tenant_id = tid

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return "", "", None, err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return "", "", None, (jsonify({"error": "Sin acceso a este espacio"}), 403)

    return user_id, tenant_id, client, None


def _fetch_thread(client: Any, thread_id: str, tenant_id: str) -> dict[str, Any] | None:
    res = (
        client.table("agent_threads")
        .select("*")
        .eq("id", thread_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return first_dict_from_execute(res)


def _bump_thread_updated_at(client: Any, thread_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    try:
        client.table("agent_threads").update({"updated_at": now}).eq("id", thread_id).execute()
    except Exception:  # noqa: BLE001
        pass


def _get_or_create_thread(
    client: Any,
    *,
    tenant_id: str,
    user_id: str,
    thread_id: str | None,
    message: str,
) -> tuple[str, Any]:
    """Devuelve (thread_id, err). Crea el thread si no viene en el body."""
    if thread_id:
        thread = _fetch_thread(client, thread_id, tenant_id)
        if not thread:
            return "", (jsonify({"error": "thread no encontrado"}), 404)
        if thread.get("user_id") != user_id:
            return "", (jsonify({"error": "Sin acceso a este thread"}), 403)
        return thread_id, None

    title = message[:80] or "Nueva conversación"
    res = (
        client.table("agent_threads")
        .insert({"tenant_id": tenant_id, "user_id": user_id, "title": title})
        .select("id")
        .execute()
    )
    new_id = (first_dict_from_execute(res) or {}).get("id")
    if not new_id:
        return "", (jsonify({"error": "No se pudo crear el thread"}), 502)
    return new_id, None


# ---------------------------------------------------------------------------
# Endpoints de threads
# ---------------------------------------------------------------------------

@bp.post("/tenants/<tenant_id>/agent/threads")
def create_thread(tenant_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    body = request.get_json(silent=True) or {}
    raw_title = (body.get("title") or "").strip()
    title = raw_title[:200] if raw_title else "Nueva conversación"

    try:
        res = (
            client.table("agent_threads")
            .insert({"tenant_id": tenant_id, "user_id": user_id, "title": title})
            .select("id, title, created_at, updated_at")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo crear el thread", "detail": str(exc)}), 502

    row = first_dict_from_execute(res) or {}
    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.created",
        payload={"thread_id": row.get("id"), "title": title},
    )
    return jsonify(row), 201


@bp.get("/tenants/<tenant_id>/agent/threads")
def list_threads(tenant_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    try:
        limit = int(request.args.get("limit", "20"))
    except (TypeError, ValueError):
        return jsonify({"error": "limit inválido"}), 400
    limit = max(1, min(limit, 100))

    cursor_raw = request.args.get("cursor", "") or ""
    c_ts, c_id = decode_cursor(cursor_raw)
    if cursor_raw and (c_ts is None or c_id is None):
        return jsonify({"error": "cursor inválido"}), 400

    rpc_args: dict[str, Any] = {
        "p_tenant_id": tenant_id,
        "p_user_id": user_id,
        "p_limit": limit + 1,
        "p_cursor_updated_at": c_ts,
        "p_cursor_id": c_id,
    }

    try:
        res = client.rpc("list_agent_threads_page", rpc_args).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al listar threads", "detail": str(exc)}), 502

    rows: list[dict[str, Any]] = list(res.data or [])
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: str | None = None
    if has_more and rows:
        next_cursor = encode_cursor(rows[-1], ts_field="updated_at")

    return jsonify({"items": rows, "next_cursor": next_cursor}), 200


@bp.get("/tenants/<tenant_id>/agent/threads/<thread_id>")
def get_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    try:
        runs_res = (
            client.table("agent_runs")
            .select("id, input_message, output_message, status, citations, created_at")
            .eq("thread_id", t_id)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al cargar los runs", "detail": str(exc)}), 502

    runs = [
        {
            "run_id": r.get("id"),
            "input_message": r.get("input_message"),
            "output_message": r.get("output_message"),
            "status": r.get("status"),
            "citations": r.get("citations") or [],
            "created_at": r.get("created_at"),
        }
        for r in (runs_res.data or [])
    ]

    return jsonify({**thread, "runs": runs}), 200


@bp.patch("/tenants/<tenant_id>/agent/threads/<thread_id>")
def rename_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    body = request.get_json(silent=True) or {}
    raw_title = (body.get("title") or "").strip()
    if not raw_title:
        return jsonify({"error": "title es obligatorio"}), 400
    title = raw_title[:200]

    try:
        res = (
            client.table("agent_threads")
            .update({"title": title})
            .eq("id", t_id)
            .select("id, title, created_at, updated_at")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo renombrar el thread", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.renamed",
        payload={"thread_id": t_id, "title": title},
    )
    return jsonify(first_dict_from_execute(res) or {}), 200


@bp.delete("/tenants/<tenant_id>/agent/threads/<thread_id>")
def delete_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    try:
        client.table("agent_threads").delete().eq("id", t_id).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo borrar el thread", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.deleted",
        payload={"thread_id": t_id},
    )
    return "", 204


# ---------------------------------------------------------------------------
# Endpoint de chat (Fase 9: agrega thread_id + citations)
# ---------------------------------------------------------------------------

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

    raw_thread_id = (body.get("thread_id") or "").strip() or None

    thread_id, err = _get_or_create_thread(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=raw_thread_id,
        message=message,
    )
    if err:
        return err

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
                thread_id=thread_id,
            )

            gemini_key = get_gemini_api_key_for_tenant(client, tenant_id)
            chat_model = get_agent_chat_model_for_tenant(client, tenant_id)
            graph = build_agent_graph(
                client,
                run_id,
                gemini_api_key=gemini_key,
                chat_model=chat_model,
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
                citations=citations,
            )

            _bump_thread_updated_at(client, thread_id)

            record_audit(
                client,
                tenant_id=tenant_id,
                actor_user_id=user_id,
                event_type="agent.chat.completed",
                payload={
                    "run_id": run_id,
                    "thread_id": thread_id,
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
                    "thread_id": thread_id,
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
        current_app.logger.exception("agent_chat falló: %s", exc)
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
                "thread_id": thread_id,
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
            jsonify({"error": "Fallo del agente", "detail": err_s, "run_id": run_id, "thread_id": thread_id}),
            502,
        )
