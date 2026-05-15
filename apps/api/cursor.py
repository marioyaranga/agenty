"""Helpers de paginación keyset con cursor opaco (base64url de JSON {c, i}).

El campo ``c`` mapea al timestamp de ordenamiento (ej. created_at o updated_at)
y el campo ``i`` al ``id`` de la fila, garantizando un tie-break estable.
"""

from __future__ import annotations

import base64
import json
from typing import Any


def decode_cursor(raw: str) -> tuple[str | None, str | None]:
    """Decodifica un cursor opaco. Devuelve (timestamp, id) o (None, None) si inválido."""
    s = (raw or "").strip()
    if not s:
        return None, None
    try:
        pad = "=" * (-len(s) % 4)
        blob = base64.urlsafe_b64decode(s + pad)
        obj = json.loads(blob.decode("utf-8"))
        if not isinstance(obj, dict):
            return None, None
        c = obj.get("c")
        i = obj.get("i")
        if c is None or i is None:
            return None, None
        return str(c), str(i)
    except Exception:  # noqa: BLE001
        return None, None


def encode_cursor(row: dict[str, Any], *, ts_field: str = "created_at") -> str:
    """Codifica la última fila de una página en cursor opaco.

    ``ts_field`` es la columna de timestamp que se usa como clave de ordenamiento;
    por defecto ``created_at``, pero puede ser ``updated_at`` u otra.
    """
    payload = json.dumps(
        {"c": row.get(ts_field), "i": row.get("id")},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8").rstrip("=")
