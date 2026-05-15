"""GET/PUT/DELETE /v1/tenants/<tenant_id>/settings/seo — DataForSEO y defaults SEO."""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from supabase import Client

from audit_log import record_audit
from secrets_crypto import encrypt_secret
from seo.dataforseo_http import validate_dataforseo_credentials
from seo.seo_keys import (
    DEFAULT_LANGUAGE_CODE,
    DEFAULT_LOCATION_CODE,
    DEFAULT_SERP_DEPTH,
    DEFAULT_SERP_MODE,
    MAX_SERP_DEPTH,
    MIN_SERP_DEPTH,
    get_effective_seo_defaults,
)
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
    require_owner_or_admin,
)

bp = Blueprint("settings_seo", __name__, url_prefix="/v1")


def _dataforseo_configured(client: Client, tenant_id: str) -> bool:
    res = (
        client.table("tenant_seo_settings")
        .select("dataforseo_login_encrypted, dataforseo_password_encrypted")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return False
    row = rows[0]
    return bool((row.get("dataforseo_login_encrypted") or "").strip()) and bool(
        (row.get("dataforseo_password_encrypted") or "").strip()
    )


def _row_exists(client: Client, tenant_id: str) -> bool:
    res = (
        client.table("tenant_seo_settings")
        .select("tenant_id")
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def _seo_response(client: Client, tenant_id: str) -> dict[str, Any]:
    defaults = get_effective_seo_defaults(client, tenant_id)
    return {
        "seo_configured": _dataforseo_configured(client, tenant_id),
        "location_code": defaults["location_code"],
        "language_code": defaults["language_code"],
        "serp_mode": defaults["serp_mode"],
        "serp_depth": defaults["serp_depth"],
        "serp_depth_min": MIN_SERP_DEPTH,
        "serp_depth_max": MAX_SERP_DEPTH,
    }


@bp.get("/tenants/<tenant_id>/settings/seo")
def get_seo_settings(tenant_id: str):
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

    return jsonify(_seo_response(client, tenant_id)), 200


@bp.put("/tenants/<tenant_id>/settings/seo")
def put_seo_settings(tenant_id: str):
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
    login_raw = (body.get("dataforseo_login") or "").strip()
    pass_raw = (body.get("dataforseo_password") or "").strip()
    if not login_raw or not pass_raw:
        return jsonify({"error": "dataforseo_login y dataforseo_password son obligatorios"}), 400
    if len(login_raw) > 256 or len(pass_raw) > 512:
        return jsonify({"error": "Credenciales demasiado largas"}), 400

    try:
        loc = int(body.get("location_code", DEFAULT_LOCATION_CODE))
    except (TypeError, ValueError):
        return jsonify({"error": "location_code inválido"}), 400
    if loc < 1:
        return jsonify({"error": "location_code debe ser positivo"}), 400

    lang = str(body.get("language_code", DEFAULT_LANGUAGE_CODE)).strip() or DEFAULT_LANGUAGE_CODE
    if len(lang) > 16:
        return jsonify({"error": "language_code inválido"}), 400

    try:
        depth = int(body.get("serp_depth", DEFAULT_SERP_DEPTH))
    except (TypeError, ValueError):
        return jsonify({"error": "serp_depth inválido"}), 400
    if depth < MIN_SERP_DEPTH or depth > MAX_SERP_DEPTH:
        return (
            jsonify(
                {
                    "error": f"serp_depth debe estar entre {MIN_SERP_DEPTH} y {MAX_SERP_DEPTH}",
                }
            ),
            400,
        )

    try:
        validate_dataforseo_credentials(login_raw, pass_raw)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        enc_login = encrypt_secret(login_raw)
        enc_pass = encrypt_secret(pass_raw)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "dataforseo_login_encrypted": enc_login,
        "dataforseo_password_encrypted": enc_pass,
        "seo_location_code": loc,
        "seo_language_code": lang,
        "seo_serp_mode": DEFAULT_SERP_MODE,
        "seo_serp_depth": depth,
        "updated_by": user_id,
    }

    try:
        client.table("tenant_seo_settings").upsert(row, on_conflict="tenant_id").execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al guardar configuración SEO", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="settings.seo.updated",
        payload={"action": "upsert_dataforseo", "location_code": loc, "language_code": lang},
    )

    return jsonify(_seo_response(client, tenant_id)), 200


@bp.delete("/tenants/<tenant_id>/settings/seo")
def delete_seo_settings(tenant_id: str):
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
        if _row_exists(client, tenant_id):
            (
                client.table("tenant_seo_settings")
                .update(
                    {
                        "dataforseo_login_encrypted": None,
                        "dataforseo_password_encrypted": None,
                        "updated_by": user_id,
                    }
                )
                .eq("tenant_id", tenant_id)
                .execute()
            )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al borrar credenciales", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="settings.seo.deleted",
        payload={"action": "clear_dataforseo_credentials"},
    )

    return ("", 204)
