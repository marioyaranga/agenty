"""Utilidades para respuestas de postgrest-py / supabase-py.

postgrest >= 0.19: ``insert()`` / ``update()`` devuelven ``SyncQueryRequestBuilder``;
su encadenamiento ``.select(...).single()`` ya no aplica porque ``single()`` solo existe
en ``SyncSelectRequestBuilder`` (p. ej. ``table().select()`` sin mutación previa).
Aquí normalizamos el resultado de ``.execute()`` a una sola fila dict.
"""

from __future__ import annotations

from typing import Any


def first_dict_from_execute(res: Any) -> dict[str, Any] | None:
    """Devuelve la primera fila como dict tras ``.execute()`` sin ``.single()``."""
    data = getattr(res, "data", None)
    if data is None:
        return None
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        if not data:
            return None
        row = data[0]
        return dict(row) if isinstance(row, dict) else None
    return None
