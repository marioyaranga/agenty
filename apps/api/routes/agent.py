"""Endpoint POST /v1/tenants/<tenant_id>/agent/chat (JWT + X-Tenant-Id + membresía)."""

from __future__ import annotations

import os
import uuid
from typing import Any

import jwt
from flask import Blueprint, jsonify, request
from supabase import Client, create_client

from agent.graph import build_agent_graph
from agent.persistence import finalize_agent_run, insert_agent_run
from agent.tracing import (
    finish_langsmith_root,
    langsmith_api_key_configured,
    optional_langsmith_root,
    trace_id_for_persistence,
)
from auth_jwt import verify_supabase_jwt

bp = Blueprint("agent", __name__, url_prefix="/v1")


def _admin_client() -> Client:
    url = os.environ["SUPABASE_URL"].strip()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    return create_client(url, key)


def _require_bearer_jwt() -> tuple[dict[str, Any] | None, tuple[Any, int] | None]:
    auth = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not auth.startswith(prefix):
        return None, (jsonify({"error": "Se requiere Authorization: Bearer"}), 401)
    token = auth[len(prefix) :].strip()
    if not token:
        return None, (jsonify({"error": "Token vacío"}), 401)
    try:
        claims = verify_supabase_jwt(token)
    except jwt.ExpiredSignatureError:
        return None, (jsonify({"error": "Token expirado"}), 401)
    except jwt.InvalidAudienceError:
        return None, (jsonify({"error": "Audiencia inválida"}), 401)
    except jwt.InvalidIssuerError:
        return None, (jsonify({"error": "Emisor inválido"}), 401)
    except jwt.PyJWTError:
        return None, (jsonify({"error": "Token inválido"}), 401)
    return claims, None


def _parse_uuid(value: str, field: str) -> tuple[str | None, tuple[Any, int] | None]:
    try:
        uuid.UUID(value)
    except ValueError:
        return None, (jsonify({"error": f"{field} debe ser un UUID"}), 400)
    return value, None


def _same_tenant_header(tenant_id: str) -> tuple[Any, tuple[Any, int] | None]:
    header = request.headers.get("X-Tenant-Id", "").strip()
    if not header:
        return None, (jsonify({"error": "Falta cabecera X-Tenant-Id"}), 400)
    if header != tenant_id:
        return None, (jsonify({"error": "X-Tenant-Id no coincide con la ruta"}), 403)
    return tenant_id, None


def _membership_role(client: Client, tenant_id: str, user_id: str) -> str | None:
    res = (
        client.table("tenant_memberships")
        .select("role")
        .eq("tenant_id", tenant_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return None
    return str(rows[0].get("role", ""))


@bp.post("/tenants/<tenant_id>/agent/chat")
def agent_chat(tenant_id: str):
    claims, err = _require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = _parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    _, err = _same_tenant_header(tenant_id)
    if err:
        return err

    client = _admin_client()
    role = _membership_role(client, tenant_id, user_id)
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

            graph = build_agent_graph(client, run_id)
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
        finish_langsmith_root(ls_root, error=err_s)
        return (
            jsonify({"error": "Fallo del agente", "detail": err_s, "run_id": run_id}),
            502,
        )
