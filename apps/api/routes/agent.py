"""Endpoints de agente de chat y threads de conversación (JWT + X-Tenant-Id + membresía).

Fase 9: threads persistentes + citations en agent_runs.

Las consultas insert/update + ``select`` usan ``first_dict_from_execute`` porque
postgrest-py reciente ya no expone ``.single()`` en ese encadenamiento.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import json

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from agent.graph import build_agent_graph
from agent.agent_steps_ui import (
    format_agent_steps_for_ui,
    tool_detail_from_result,
    tool_label_description,
)
from agent.persistence import (
    finalize_agent_run,
    insert_agent_run,
    list_agent_steps_for_run,
    list_agent_steps_for_runs,
)
from agent_chat_models import get_agent_chat_model_for_tenant  # noqa: F401 — usado fuera del chat endpoint
from agent.tracing import (
    finish_langsmith_root,
    langsmith_api_key_configured,
    optional_langsmith_root,
    trace_id_for_persistence,
)
from audit_log import record_audit
from cursor import decode_cursor, encode_cursor
from gemini_keys import get_gemini_api_key_for_tenant, get_tenant_ai_config, resolve_gemini_api_key
from notifications import notify_agent_chat_outcome
from postgrest_utils import first_dict_from_execute
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("agent", __name__, url_prefix="/v1")

# ---------------------------------------------------------------------------
# Helpers SSE
# ---------------------------------------------------------------------------

_NODE_SSE: dict[str, tuple[str, str]] = {
    "retrieve": ("Buscando en documentos…", "Búsqueda semántica en tu base de conocimiento."),
    "rewrite_query": ("Refinando la búsqueda…", "Mejorando la consulta para obtener mejores resultados."),
    "generate": ("Generando respuesta…", "Analizando el contexto y redactando la respuesta."),
    "execute_tool": ("Ejecutando herramienta…", "Realizando una acción en tu espacio de trabajo."),
    "respond_no_context": ("Preparando respuesta…", "Redactando la respuesta."),
}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _next_rag_node(
    completed: str,
    state: dict,
    *,
    min_ok_sim: float,
    max_attempts: int,
) -> str | None:
    """Predice el próximo nodo del grafo para el indicador SSE de 'running'."""
    if completed == "retrieve":
        matches = list(state.get("matches") or [])
        best = max((float(m.get("similarity") or 0.0) for m in matches), default=0.0)
        context_ok = bool(matches) and best >= min_ok_sim
        if context_ok:
            return "generate"
        n = int(state.get("retrieval_count") or 0)
        return "rewrite_query" if n < max_attempts else "generate"
    if completed == "rewrite_query":
        return "retrieve"
    if completed == "generate":
        if state.get("pending_tool_name"):
            return "execute_tool"
        return None
    if completed == "execute_tool":
        return "generate"
    return None


_ACK_PROMPT = (
    "Sos un asistente de IA. El usuario te envió este mensaje:\n"
    "\"{message}\"\n\n"
    "Respondé SOLO con 1 frase corta en español (máximo 10 palabras) que reconozca "
    "su pedido y muestre que lo estás procesando ahora. "
    "No des la respuesta final. Sin comillas ni punto al final."
)


def _generate_quick_ack(message: str, api_key: str, model: str) -> str:
    """Genera 1 frase de reconocimiento contextual con Gemini (rápido, Flash)."""
    try:
        from google import genai  # importación local para no romper si falla
        prompt = _ACK_PROMPT.format(message=message[:400])
        client = genai.Client(api_key=resolve_gemini_api_key(api_key=api_key))
        resp = client.models.generate_content(model=model, contents=prompt)
        text = (resp.text or "").strip() if hasattr(resp, "text") else ""
        text = " ".join(text.splitlines()).strip().strip('"').strip()
        return text[:120] if text else "Entendido, dame un momento."
    except Exception:  # noqa: BLE001
        return "Entendido, dame un momento."


def _read_float_env(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _read_int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default

# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _auth_common(tenant_id: str) -> tuple[str, str, Any, Any]:
    """Valida JWT + header + membresía. Devuelve (user_id, tenant_id, client, err)."""
    claims, err = require_bearer_jwt()
    if err:
        return "", "", None, err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return "", "", None, err
    tenant_id = tid

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return "", "", None, err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return "", "", None, (jsonify({"error": "Sin acceso a este espacio"}), 403)

    return user_id, tenant_id, client, None


def _fetch_thread(client: Any, thread_id: str, tenant_id: str) -> dict[str, Any] | None:
    res = (
        client.table("agent_threads")
        .select("*")
        .eq("id", thread_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return first_dict_from_execute(res)


def _bump_thread_updated_at(client: Any, thread_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    try:
        client.table("agent_threads").update({"updated_at": now}).eq("id", thread_id).execute()
    except Exception:  # noqa: BLE001
        pass


def _load_recent_history(
    client: Any,
    *,
    thread_id: str,
    max_turns: int,
    max_chars_per_turn: int,
) -> list[dict[str, Any]]:
    """Devuelve [{role, content}, ...] de los últimos max_turns turnos completados."""
    try:
        res = (
            client.table("agent_runs")
            .select("input_message, output_message")
            .eq("thread_id", thread_id)
            .eq("status", "completed")
            .order("created_at", desc=True)
            .limit(max_turns)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []

    rows = [r for r in (res.data or []) if r.get("output_message")]
    rows.reverse()

    history: list[dict[str, Any]] = []
    for r in rows:
        user_content = str(r.get("input_message") or "")[:max_chars_per_turn]
        asst_content = str(r.get("output_message") or "")[:max_chars_per_turn]
        history.append({"role": "user", "content": user_content})
        history.append({"role": "assistant", "content": asst_content})
    return history


def _get_or_create_thread(
    client: Any,
    *,
    tenant_id: str,
    user_id: str,
    thread_id: str | None,
    message: str,
) -> tuple[str, Any]:
    """Devuelve (thread_id, err). Crea el thread si no viene en el body."""
    if thread_id:
        thread = _fetch_thread(client, thread_id, tenant_id)
        if not thread:
            return "", (jsonify({"error": "thread no encontrado"}), 404)
        if thread.get("user_id") != user_id:
            return "", (jsonify({"error": "Sin acceso a este thread"}), 403)
        return thread_id, None

    title = message[:80] or "Nueva conversación"
    res = (
        client.table("agent_threads")
        .insert({"tenant_id": tenant_id, "user_id": user_id, "title": title})
        .select("id")
        .execute()
    )
    new_id = (first_dict_from_execute(res) or {}).get("id")
    if not new_id:
        return "", (jsonify({"error": "No se pudo crear el thread"}), 502)
    return new_id, None


# ---------------------------------------------------------------------------
# Endpoints de threads
# ---------------------------------------------------------------------------

@bp.post("/tenants/<tenant_id>/agent/threads")
def create_thread(tenant_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    body = request.get_json(silent=True) or {}
    raw_title = (body.get("title") or "").strip()
    title = raw_title[:200] if raw_title else "Nueva conversación"

    try:
        res = (
            client.table("agent_threads")
            .insert({"tenant_id": tenant_id, "user_id": user_id, "title": title})
            .select("id, title, created_at, updated_at")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo crear el thread", "detail": str(exc)}), 502

    row = first_dict_from_execute(res) or {}
    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.created",
        payload={"thread_id": row.get("id"), "title": title},
    )
    return jsonify(row), 201


@bp.get("/tenants/<tenant_id>/agent/threads")
def list_threads(tenant_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    try:
        limit = int(request.args.get("limit", "20"))
    except (TypeError, ValueError):
        return jsonify({"error": "limit inválido"}), 400
    limit = max(1, min(limit, 100))

    cursor_raw = request.args.get("cursor", "") or ""
    c_ts, c_id = decode_cursor(cursor_raw)
    if cursor_raw and (c_ts is None or c_id is None):
        return jsonify({"error": "cursor inválido"}), 400

    rpc_args: dict[str, Any] = {
        "p_tenant_id": tenant_id,
        "p_user_id": user_id,
        "p_limit": limit + 1,
        "p_cursor_updated_at": c_ts,
        "p_cursor_id": c_id,
    }

    try:
        res = client.rpc("list_agent_threads_page", rpc_args).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al listar threads", "detail": str(exc)}), 502

    rows: list[dict[str, Any]] = list(res.data or [])
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: str | None = None
    if has_more and rows:
        next_cursor = encode_cursor(rows[-1], ts_field="updated_at")

    return jsonify({"items": rows, "next_cursor": next_cursor}), 200


@bp.get("/tenants/<tenant_id>/agent/threads/<thread_id>")
def get_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    try:
        runs_res = (
            client.table("agent_runs")
            .select("id, input_message, output_message, status, citations, created_at")
            .eq("thread_id", t_id)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al cargar los runs", "detail": str(exc)}), 502

    raw_runs = list(runs_res.data or [])
    run_ids = [str(r.get("id")) for r in raw_runs if r.get("id")]

    steps_by_run: dict[str, list[dict[str, Any]]] = {rid: [] for rid in run_ids}
    try:
        all_steps = list_agent_steps_for_runs(client, run_ids)
        grouped: dict[str, list[dict[str, Any]]] = {rid: [] for rid in run_ids}
        for row in all_steps:
            rid = str(row.get("run_id") or "")
            if rid in grouped:
                grouped[rid].append(row)
        for rid, rows in grouped.items():
            steps_by_run[rid] = format_agent_steps_for_ui(rows)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.warning("get_thread: no se pudieron cargar agent_steps: %s", exc)

    runs = [
        {
            "run_id": r.get("id"),
            "input_message": r.get("input_message"),
            "output_message": r.get("output_message"),
            "status": r.get("status"),
            "citations": r.get("citations") or [],
            "created_at": r.get("created_at"),
            "steps": steps_by_run.get(str(r.get("id")), []),
        }
        for r in raw_runs
    ]

    return jsonify({**thread, "runs": runs}), 200


@bp.patch("/tenants/<tenant_id>/agent/threads/<thread_id>")
def rename_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    body = request.get_json(silent=True) or {}
    raw_title = (body.get("title") or "").strip()
    if not raw_title:
        return jsonify({"error": "title es obligatorio"}), 400
    title = raw_title[:200]

    try:
        res = (
            client.table("agent_threads")
            .update({"title": title})
            .eq("id", t_id)
            .select("id, title, created_at, updated_at")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo renombrar el thread", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.renamed",
        payload={"thread_id": t_id, "title": title},
    )
    return jsonify(first_dict_from_execute(res) or {}), 200


@bp.delete("/tenants/<tenant_id>/agent/threads/<thread_id>")
def delete_thread(tenant_id: str, thread_id: str):
    user_id, tenant_id, client, err = _auth_common(tenant_id)
    if err:
        return err

    t_id, err = parse_uuid(thread_id, "thread_id")
    if err:
        return err

    thread = _fetch_thread(client, t_id, tenant_id)
    if not thread:
        return jsonify({"error": "thread no encontrado"}), 404
    if thread.get("user_id") != user_id:
        return jsonify({"error": "Sin acceso a este thread"}), 403

    try:
        client.table("agent_threads").delete().eq("id", t_id).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "No se pudo borrar el thread", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.thread.deleted",
        payload={"thread_id": t_id},
    )
    return "", 204


# ---------------------------------------------------------------------------
# Endpoint de chat — SSE streaming (nodos LangGraph en tiempo real)
# ---------------------------------------------------------------------------

@bp.post("/tenants/<tenant_id>/agent/chat")
def agent_chat(tenant_id: str):
    # --- Auth + setup síncrono (puede devolver errores HTTP normales) ---
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

    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message es obligatorio"}), 400

    raw_thread_id = (body.get("thread_id") or "").strip() or None

    pinned_docs: list[dict] = []
    raw_mentions = body.get("mentions") or []
    if isinstance(raw_mentions, list):
        for m in raw_mentions[:5]:
            if not isinstance(m, dict):
                continue
            doc_id = str(m.get("id") or "").strip()
            if not doc_id:
                continue
            try:
                doc_res = (
                    client.table("documents")
                    .select("id, title, storage_path")
                    .eq("id", doc_id)
                    .eq("tenant_id", tenant_id)
                    .limit(1)
                    .execute()
                )
                if not (doc_res.data or []):
                    continue
                doc = doc_res.data[0]
                raw_bytes = client.storage.from_("tenant_documents").download(
                    str(doc["storage_path"])
                )
                content = raw_bytes.decode("utf-8", errors="replace")[:20_000]
                pinned_docs.append({
                    "id": doc_id,
                    "name": str(m.get("name") or doc.get("title") or ""),
                    "content": content,
                })
            except Exception:  # noqa: BLE001
                pass

    thread_id, err = _get_or_create_thread(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=raw_thread_id,
        message=message,
    )
    if err:
        return err

    run_id = str(uuid.uuid4())

    # --- Generador SSE (ejecuta el grafo en streaming) ---
    # Contrato SSE (líneas `data: {json}`):
    # - ack: reconocimiento rápido { text }
    # - started: { run_id, thread_id }
    # - step: nodo LangGraph { node, label, description, status: running|done }
    # - tool: herramienta { tool_name, label, description, status: running|done, ok?, detail? }
    # - done: respuesta final { answer, citations, steps[], run_id, thread_id, ... }
    # - error: { detail, run_id?, thread_id? }
    def generate_sse():  # noqa: C901
        ls_root: Any = None
        trace_id: str | None = None

        try:
            with optional_langsmith_root(
                name="workyai_agent_chat",
                inputs={"message": message[:2000], "tenant_id": tenant_id},
            ) as ls_rt:
                ls_root = ls_rt
                trace_id = trace_id_for_persistence(ls_root)

                ai_config = get_tenant_ai_config(client, tenant_id)
                gemini_key = ai_config["api_key"]
                chat_model = ai_config["chat_model"]

                max_turns = max(1, min(50, _read_int_env("AGENT_HISTORY_MAX_TURNS", 10)))
                max_chars = max(100, _read_int_env("AGENT_HISTORY_MAX_CHARS_PER_TURN", 4000))
                history = _load_recent_history(
                    client,
                    thread_id=thread_id,
                    max_turns=max_turns,
                    max_chars_per_turn=max_chars,
                )

                graph = build_agent_graph(
                    client,
                    run_id,
                    gemini_api_key=gemini_key,
                    chat_model=chat_model,
                    user_id=user_id,
                    langsmith_parent=ls_root,
                )

                # Reconocimiento contextual generado por Gemini (antes de insert para minimizar latencia)
                ack_text = _generate_quick_ack(message, gemini_key, chat_model)
                yield _sse({"type": "ack", "text": ack_text})

                insert_agent_run(
                    client,
                    run_id=run_id,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    input_message=message,
                    thread_id=thread_id,
                )

                # Señalización de inicio + primer nodo arrancando
                yield _sse({"type": "started", "run_id": run_id, "thread_id": thread_id})
                lbl0, desc0 = _NODE_SSE["retrieve"]
                yield _sse({"type": "step", "node": "retrieve", "status": "running", "label": lbl0, "description": desc0})

                initial_state = {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "message": message,
                    "history": history,
                    "pinned_docs": pinned_docs,
                }

                min_ok_sim = _read_float_env("AGENT_CONTEXT_OK_MIN_SIMILARITY", 0.24)
                max_att = min(2, max(1, _read_int_env("AGENT_MAX_RETRIEVAL_ATTEMPTS", 2)))

                accumulated: dict[str, Any] = {}
                for chunk in graph.stream(initial_state, stream_mode="updates"):
                    for node_name, updates in chunk.items():
                        if node_name.startswith("_"):
                            continue
                        if isinstance(updates, dict):
                            accumulated.update(updates)

                        if node_name != "execute_tool":
                            lbl, desc = _NODE_SSE.get(node_name, (node_name, ""))
                            yield _sse({"type": "step", "node": node_name, "status": "done", "label": lbl, "description": desc})

                        if node_name == "execute_tool":
                            tool_results = list(accumulated.get("tool_results") or [])
                            if tool_results:
                                last = tool_results[-1]
                                tname = str(last.get("tool_name") or "")
                                result = last.get("result") if isinstance(last.get("result"), dict) else {}
                                t_lbl, t_desc = tool_label_description(tname)
                                ok = bool(result.get("ok")) if isinstance(result, dict) else False
                                detail = tool_detail_from_result(tname, result) if isinstance(result, dict) else ""
                                yield _sse({
                                    "type": "tool",
                                    "tool_name": tname,
                                    "label": t_lbl,
                                    "description": t_desc,
                                    "status": "done",
                                    "ok": ok,
                                    "detail": detail or None,
                                })

                        next_n = _next_rag_node(node_name, accumulated, min_ok_sim=min_ok_sim, max_attempts=max_att)
                        if next_n:
                            if next_n == "execute_tool":
                                pending = str(accumulated.get("pending_tool_name") or "")
                                if pending:
                                    t_lbl, t_desc = tool_label_description(pending)
                                    yield _sse({
                                        "type": "tool",
                                        "tool_name": pending,
                                        "label": t_lbl,
                                        "description": t_desc,
                                        "status": "running",
                                    })
                            else:
                                n_lbl, n_desc = _NODE_SSE.get(next_n, (next_n, ""))
                                yield _sse({"type": "step", "node": next_n, "status": "running", "label": n_lbl, "description": n_desc})

                answer = str(accumulated.get("answer") or "")
                citations = list(accumulated.get("citations") or [])
                step_rows = list_agent_steps_for_run(client, run_id)
                steps = format_agent_steps_for_ui(step_rows)

                finalize_agent_run(
                    client,
                    run_id=run_id,
                    status="completed",
                    output_message=answer,
                    langsmith_trace_id=trace_id,
                    citations=citations,
                )
                _bump_thread_updated_at(client, thread_id)
                record_audit(
                    client,
                    tenant_id=tenant_id,
                    actor_user_id=user_id,
                    event_type="agent.chat.completed",
                    payload={
                        "run_id": run_id,
                        "thread_id": thread_id,
                        "message_preview": message[:400],
                        "answer_preview": answer[:400],
                        "citations_count": len(citations),
                    },
                    agent_run_id=run_id,
                )
                notify_agent_chat_outcome(
                    client,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    run_id=run_id,
                    completed=True,
                )
                finish_langsmith_root(ls_root, outputs={"run_id": run_id, "answer_preview": answer[:500]})

                yield _sse({
                    "type": "done",
                    "run_id": run_id,
                    "thread_id": thread_id,
                    "answer": answer,
                    "citations": citations,
                    "steps": steps,
                    "langsmith_trace_id": trace_id,
                    "langsmith_enabled": langsmith_api_key_configured(),
                })

        except Exception as exc:  # noqa: BLE001
            err_s = str(exc)[:8000]
            current_app.logger.exception("agent_chat SSE falló: %s", exc)
            try:
                finalize_agent_run(client, run_id=run_id, status="failed", error=err_s, langsmith_trace_id=trace_id)
            except Exception:  # noqa: BLE001
                pass
            try:
                record_audit(
                    client,
                    tenant_id=tenant_id,
                    actor_user_id=user_id,
                    event_type="agent.chat.failed",
                    payload={"run_id": run_id, "thread_id": thread_id, "message_preview": message[:400], "detail_preview": err_s[:800]},
                    agent_run_id=run_id,
                )
            except Exception:  # noqa: BLE001
                pass
            try:
                notify_agent_chat_outcome(client, tenant_id=tenant_id, user_id=user_id, run_id=run_id, completed=False, detail=err_s)
            except Exception:  # noqa: BLE001
                pass
            try:
                finish_langsmith_root(ls_root, error=err_s)
            except Exception:  # noqa: BLE001
                pass
            yield _sse({"type": "error", "detail": err_s, "run_id": run_id, "thread_id": thread_id})

    return Response(
        stream_with_context(generate_sse()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
