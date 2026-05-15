"""HTTP JSON a DataForSEO con autenticación Basic (stdlib)."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from typing import Any

DATAFORSEO_BASE = "https://api.dataforseo.com"


def dataforseo_post(
    login: str,
    password: str,
    path: str,
    payload: list[dict[str, Any]],
    *,
    timeout: float = 120.0,
) -> dict[str, Any]:
    """POST JSON; devuelve el cuerpo parseado o lanza con mensaje legible."""
    url = f"{DATAFORSEO_BASE}{path}"
    body = json.dumps(payload).encode("utf-8")
    token = base64.b64encode(f"{login}:{password}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"DataForSEO HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"DataForSEO red: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("DataForSEO devolvió JSON inválido") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("DataForSEO: respuesta inesperada")
    status = parsed.get("status_code")
    if status is not None and int(status) != 20000:
        msg = parsed.get("status_message") or "error desconocido"
        raise RuntimeError(f"DataForSEO API: {msg} (status_code={status})")
    return parsed


def validate_dataforseo_credentials(login: str, password: str) -> None:
    """Opcional: GET /v3/appendix/user_data para comprobar credenciales."""
    url = f"{DATAFORSEO_BASE}/v3/appendix/user_data"
    token = base64.b64encode(f"{login}:{password}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Basic {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise RuntimeError("Credenciales DataForSEO inválidas") from exc
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"DataForSEO validación HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"DataForSEO validación: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("DataForSEO validación: JSON inválido") from exc
    if isinstance(parsed, dict):
        sc = parsed.get("status_code")
        if sc is not None and int(sc) != 20000:
            msg = parsed.get("status_message") or "credenciales rechazadas"
            raise RuntimeError(f"DataForSEO: {msg}")
