"""GET /v1/tenants/<tenant_id>/audit — eventos append-only (owner/admin)."""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from cursor import decode_cursor, encode_cursor
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
    require_owner_or_admin,
)

bp = Blueprint("audit", __name__, url_prefix="/v1")


@bp.get("/tenants/<tenant_id>/audit")
def list_audit(tenant_id: str):
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
    ra = require_owner_or_admin(role)
    if ra:
        return ra

    try:
        limit = int(request.args.get("limit", "50"))
    except (TypeError, ValueError):
        return jsonify({"error": "limit inválido"}), 400
    limit = max(1, min(limit, 100))

    cursor_raw = request.args.get("cursor", "") or ""
    c_ts, c_id = decode_cursor(cursor_raw)
    if cursor_raw and (c_ts is None or c_id is None):
        return jsonify({"error": "cursor inválido"}), 400

    rpc_args: dict[str, Any] = {
        "p_tenant_id": tenant_id,
        "p_limit": limit + 1,
        "p_cursor_created_at": c_ts,
        "p_cursor_id": c_id,
    }

    try:
        res = client.rpc("list_audit_events_page", rpc_args).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al listar auditoría", "detail": str(exc)}), 502

    rows: list[dict[str, Any]] = list(res.data or [])
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: str | None = None
    if has_more and rows:
        next_cursor = encode_cursor(rows[-1])

    return (
        jsonify(
            {
                "items": rows,
                "next_cursor": next_cursor,
            }
        ),
        200,
    )
