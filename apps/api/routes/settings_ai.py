"""GET/PUT/DELETE /v1/tenants/<tenant_id>/settings/ai — clave Gemini por tenant (cifrada)."""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from supabase import Client

from audit_log import record_audit
from gemini_keys import get_gemini_api_key_for_tenant
from secrets_crypto import encrypt_secret
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
    require_owner_or_admin,
)

bp = Blueprint("settings_ai", __name__, url_prefix="/v1")


def _gemini_configured(client: Client, tenant_id: str) -> bool:
    res = (
        client.table("tenant_ai_settings")
        .select("gemini_api_key_encrypted")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return False
    return bool((rows[0].get("gemini_api_key_encrypted") or "").strip())


@bp.get("/tenants/<tenant_id>/settings/ai")
def get_ai_settings(tenant_id: str):
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

    return jsonify({"gemini_configured": _gemini_configured(client, tenant_id)}), 200


@bp.put("/tenants/<tenant_id>/settings/ai")
def put_ai_settings(tenant_id: str):
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

    body = request.get_json(silent=True) or {}
    raw_key = (body.get("gemini_api_key") or "").strip()
    if not raw_key or len(raw_key) < 8 or len(raw_key) > 512:
        return jsonify({"error": "gemini_api_key inválida (8–512 caracteres)"}), 400

    try:
        enc = encrypt_secret(raw_key)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    row = {
        "tenant_id": tenant_id,
        "gemini_api_key_encrypted": enc,
        "updated_by": user_id,
    }

    try:
        client.table("tenant_ai_settings").upsert(row, on_conflict="tenant_id").execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al guardar configuración", "detail": str(exc)}), 502

    try:
        get_gemini_api_key_for_tenant(client, tenant_id)
    except Exception as exc:  # noqa: BLE001
        return jsonify(
            {
                "error": "La clave se guardó pero no pudo validarse al descifrar",
                "detail": str(exc),
            }
        ), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="settings.ai.updated",
        payload={"action": "upsert_gemini_key"},
    )

    return jsonify({"gemini_configured": True}), 200


@bp.delete("/tenants/<tenant_id>/settings/ai")
def delete_ai_settings(tenant_id: str):
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
        client.table("tenant_ai_settings").delete().eq("tenant_id", tenant_id).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al borrar configuración", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="settings.ai.deleted",
        payload={"action": "delete_gemini_key"},
    )

    return ("", 204)
