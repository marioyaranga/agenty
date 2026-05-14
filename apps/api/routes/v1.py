"""Endpoints bajo /v1 (JWT Supabase + comprobación de tenant opcional)."""

from __future__ import annotations

import os
import uuid
from typing import Any

import jwt
from flask import Blueprint, jsonify, request
from supabase import Client, create_client

from auth_jwt import verify_supabase_jwt

bp = Blueprint("v1", __name__, url_prefix="/v1")


def _admin_client() -> Client:
    url = os.environ["SUPABASE_URL"].strip()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    return create_client(url, key)


@bp.get("/me")
def me():
    auth = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not auth.startswith(prefix):
        return jsonify({"error": "Se requiere Authorization: Bearer"}), 401

    token = auth[len(prefix) :].strip()
    if not token:
        return jsonify({"error": "Token vacío"}), 401

    try:
        claims = verify_supabase_jwt(token)
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expirado"}), 401
    except jwt.InvalidAudienceError:
        return jsonify({"error": "Audiencia inválida"}), 401
    except jwt.InvalidIssuerError:
        return jsonify({"error": "Emisor inválido"}), 401
    except jwt.PyJWTError:
        return jsonify({"error": "Token inválido"}), 401

    user_id = str(claims.get("sub", ""))
    email = claims.get("email")

    tenant_header = request.headers.get("X-Tenant-Id", "").strip()
    tenant_id: str | None = None
    role: str | None = None

    if tenant_header:
        try:
            uuid.UUID(tenant_header)
        except ValueError:
            return jsonify({"error": "X-Tenant-Id debe ser un UUID"}), 400

        client = _admin_client()
        res = (
            client.table("tenant_memberships")
            .select("role")
            .eq("tenant_id", tenant_header)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows: list[dict[str, Any]] = res.data or []
        if not rows:
            return jsonify({"error": "Sin acceso a este espacio"}), 403
        tenant_id = tenant_header
        role = str(rows[0].get("role", ""))

    body: dict[str, Any] = {
        "user_id": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
    }
    return jsonify(body), 200
