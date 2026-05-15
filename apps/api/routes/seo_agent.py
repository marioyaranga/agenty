"""POST /v1/tenants/<tenant_id>/agent/seo/chat — orquestador SEO (editor+)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, current_app, jsonify, request

from agent.persistence import finalize_agent_run, insert_agent_run, list_agent_steps_for_run
from agent.tracing import (
    finish_langsmith_root,
    langsmith_api_key_configured,
    optional_langsmith_root,
    trace_id_for_persistence,
)
from agent_chat_models import get_agent_chat_model_for_tenant
from audit_log import record_audit
from gemini_keys import get_gemini_api_key_for_tenant
from notifications import notify_agent_chat_outcome
from postgrest_utils import first_dict_from_execute
from seo.seo_graph import build_seo_graph
from seo.seo_steps import format_seo_steps_for_ui
from seo.seo_keys import dataforseo_configured, get_dataforseo_secrets_for_tenant, get_effective_seo_defaults
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("seo_agent", __name__, url_prefix="/v1")

EDITOR_ROLES = frozenset({"editor", "admin", "owner"})


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
    if thread_id:
        thread = _fetch_thread(client, thread_id, tenant_id)
        if not thread:
            return "", (jsonify({"error": "thread no encontrado"}), 404)
        if thread.get("user_id") != user_id:
            return "", (jsonify({"error": "Sin acceso a este thread"}), 403)
        return thread_id, None

    title = f"SEO: {(message[:60] or 'Consulta SEO').strip()}"
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


@bp.post("/tenants/<tenant_id>/agent/seo/chat")
def seo_chat(tenant_id: str):
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
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    if not dataforseo_configured(client, tenant_id):
        return (
            jsonify(
                {
                    "error": "DataForSEO no está configurado para este espacio. "
                    "Configurá las credenciales en Ajustes → DataForSEO."
                }
            ),
            400,
        )

    secrets = get_dataforseo_secrets_for_tenant(client, tenant_id)
    if not secrets:
        return (
            jsonify(
                {
                    "error": "No se pudieron cargar las credenciales DataForSEO. "
                    "Volvé a guardarlas en Ajustes."
                }
            ),
            502,
        )
    dfs_login, dfs_password = secrets

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
    seo_defaults = get_effective_seo_defaults(client, tenant_id)

    try:
        with optional_langsmith_root(
            name="workyai_seo_chat",
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
            graph = build_seo_graph(
                client,
                run_id,
                gemini_api_key=gemini_key,
                chat_model=chat_model,
                dataforseo_login=dfs_login,
                dataforseo_password=dfs_password,
                seo_defaults=seo_defaults,
                langsmith_parent=ls_root,
            )
            final = graph.invoke(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "message": message,
                    "gemini_api_key": gemini_key,
                    "chat_model": chat_model,
                    "seo_defaults": seo_defaults,
                    "dataforseo_login": dfs_login,
                    "dataforseo_password": dfs_password,
                }
            )

            answer = str(final.get("answer") or "")
            step_rows = list_agent_steps_for_run(client, run_id)
            steps = format_seo_steps_for_ui(step_rows)

            finalize_agent_run(
                client,
                run_id=run_id,
                status="completed",
                output_message=answer,
                langsmith_trace_id=trace_id,
                citations=[],
            )

            _bump_thread_updated_at(client, thread_id)

            record_audit(
                client,
                tenant_id=tenant_id,
                actor_user_id=user_id,
                event_type="agent.seo.chat.completed",
                payload={
                    "run_id": run_id,
                    "thread_id": thread_id,
                    "message_preview": message[:400],
                    "answer_preview": answer[:400],
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
                outputs={"run_id": run_id, "answer_preview": answer[:500]},
            )

        return (
            jsonify(
                {
                    "run_id": run_id,
                    "thread_id": thread_id,
                    "answer": answer,
                    "citations": [],
                    "steps": steps,
                    "langsmith_trace_id": trace_id,
                    "langsmith_enabled": langsmith_api_key_configured(),
                }
            ),
            200,
        )
    except Exception as exc:  # noqa: BLE001
        err_s = str(exc)[:8000]
        current_app.logger.exception("seo_chat falló: %s", exc)
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
            event_type="agent.seo.chat.failed",
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
            jsonify(
                {
                    "error": "Fallo del agente SEO",
                    "detail": err_s,
                    "run_id": run_id,
                    "thread_id": thread_id,
                }
            ),
            502,
        )
