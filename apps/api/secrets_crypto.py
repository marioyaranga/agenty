"""Cifrado simétrico Fernet para secretos por tenant (clave maestra en entorno)."""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    raw = (os.environ.get("TENANT_SECRETS_FERNET_KEY") or "").strip()
    if not raw:
        raise RuntimeError("TENANT_SECRETS_FERNET_KEY no configurada")
    return Fernet(raw.encode("ascii"))


def encrypt_secret(plaintext: str) -> str:
    """Cifra texto UTF-8 y devuelve token ASCII seguro para almacenar en Postgres."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    """Descifra un token generado por `encrypt_secret`."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Token cifrado inválido o clave Fernet incorrecta") from exc
