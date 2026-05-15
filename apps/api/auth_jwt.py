"""Validación de JWT emitidos por Supabase Auth (JWKS, iss, aud, exp, role).

Proyectos recientes pueden firmar con ES256 (JWKS con kty EC); otros usan RS256.
Ambos deben figurar en `algorithms` de `jwt.decode` para que la verificación coincida con el header del token.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient


@lru_cache(maxsize=1)
def _jwk_client() -> PyJWKClient:
    base = os.environ["SUPABASE_URL"].strip().rstrip("/")
    jwks_url = f"{base}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url, cache_keys=True)


def issuer() -> str:
    return os.environ["SUPABASE_URL"].strip().rstrip("/") + "/auth/v1"


def audience() -> str:
    return os.environ.get("JWT_AUDIENCE", "authenticated").strip() or "authenticated"


def verify_supabase_jwt(token: str) -> dict[str, Any]:
    """Devuelve el payload del JWT o lanza jwt.PyJWTError."""
    signing_key = _jwk_client().get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience=audience(),
        issuer=issuer(),
        options={"require": ["exp", "sub", "iss", "aud"]},
    )
    if payload.get("role") != "authenticated":
        raise jwt.InvalidTokenError("Rol JWT no permitido")
    return payload
