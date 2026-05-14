"""LangSmith opcional: sin claves el chat sigue; con claves se publica un run raíz y se guarda su trace id."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator


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
    """Context manager que devuelve un `RunTree` publicado o None si no aplica / falla."""
    if not langsmith_api_key_configured():
        yield None
        return
    try:
        from langsmith.run_trees import RunTree

        rt = RunTree(name=name, run_type="chain", inputs=inputs)
        rt.post(exclude_child_runs=True)
        yield rt
    except Exception:  # noqa: BLE001 — tracing nunca debe tumbar el chat
        yield None


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
