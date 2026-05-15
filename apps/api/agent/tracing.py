"""LangSmith opcional: sin claves el chat sigue; con claves se publica un run raíz y se guarda su trace id."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator


@contextmanager
def traced_graph_node(
    parent: Any | None,
    *,
    name: str,
    inputs: dict[str, Any],
) -> Iterator[tuple[Any | None, dict[str, Any]]]:
    """Span hijo bajo el run raíz; los fallos de tracing no tumban el nodo (solo se omiten spans)."""
    holder: dict[str, Any] = {}
    ch: Any | None = None
    if parent is not None:
        try:
            ch = parent.create_child(name, run_type="chain", inputs=inputs)
            ch.post(exclude_child_runs=True)
        except Exception:  # noqa: BLE001
            ch = None
    try:
        yield ch, holder
        if ch is not None:
            try:
                ch.end(outputs=holder.get("outputs") or {})
                ch.patch()
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:
        if ch is not None:
            try:
                ch.end(outputs={}, error=str(exc)[:8000])
                ch.patch()
            except Exception:  # noqa: BLE001
                pass
        raise


def langsmith_api_key_configured() -> bool:
    return bool(
        (os.environ.get("LANGCHAIN_API_KEY") or os.environ.get("LANGSMITH_API_KEY") or "").strip()
    )


@contextmanager
def optional_langsmith_root(
    *,
    name: str,
    inputs: dict[str, Any],
) -> Iterator[Any]:
    """Context manager que devuelve un `RunTree` publicado o None si no aplica / falla.

    Un solo ``yield`` en el generador: si ``post()`` falla no se puede hacer
    ``yield`` dentro del ``except`` tras un ``yield`` previo; si el cuerpo del
    ``with`` lanza, un segundo ``yield`` rompe el protocolo y produce
    ``generator didn't stop after throw()``.
    """
    if not langsmith_api_key_configured():
        yield None
        return
    rt: Any | None = None
    try:
        from langsmith.run_trees import RunTree

        rt = RunTree(name=name, run_type="chain", inputs=inputs)
        rt.post(exclude_child_runs=True)
    except Exception:  # noqa: BLE001 — tracing nunca debe tumbar el chat
        rt = None
    yield rt


def trace_id_for_persistence(rt: Any | None) -> str | None:
    if rt is None:
        return None
    tid = getattr(rt, "trace_id", None)
    if tid is None:
        return None
    return str(tid)


def finish_langsmith_root(
    rt: Any | None,
    *,
    outputs: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if rt is None:
        return
    try:
        rt.end(outputs=outputs or {}, error=error)
        rt.patch()
    except Exception:  # noqa: BLE001
        pass
