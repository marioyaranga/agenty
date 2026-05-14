"""Cabeceras JWT Supabase, X-Tenant-Id y membresía por tenant (compartido entre blueprints)."""

from __future__ import annotations

import os
import uuid
from typing import Any

import jwt
from flask import jsonify, request
from supabase import Client, create_client

from auth_jwt import verify_supabase_jwt


def admin_supabase_client() -> Client:
    url = os.environ["SUPABASE_URL"].strip()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    return create_client(url, key)


def require_bearer_jwt() -> tuple[dict[str, Any] | None, tuple[Any, int] | None]:
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


def parse_uuid(value: str, field: str) -> tuple[str | None, tuple[Any, int] | None]:
    try:
        uuid.UUID(value)
    except ValueError:
        return None, (jsonify({"error": f"{field} debe ser un UUID"}), 400)
    return value, None


def require_matching_tenant_header(tenant_id: str) -> tuple[Any, tuple[Any, int] | None]:
    header = request.headers.get("X-Tenant-Id", "").strip()
    if not header:
        return None, (jsonify({"error": "Falta cabecera X-Tenant-Id"}), 400)
    if header != tenant_id:
        return None, (jsonify({"error": "X-Tenant-Id no coincide con la ruta"}), 403)
    return tenant_id, None


OWNER_ADMIN_ROLES = frozenset({"owner", "admin"})


def membership_role(client: Client, tenant_id: str, user_id: str) -> str | None:
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


def require_owner_or_admin(role: str | None) -> tuple[Any, int] | None:
    """403 si el rol no es owner ni admin (reutilizable en blueprints)."""
    if not role or role not in OWNER_ADMIN_ROLES:
        return (jsonify({"error": "Se requiere rol owner o admin"}), 403)
    return None
