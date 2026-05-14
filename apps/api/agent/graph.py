"""Grafo LangGraph: recuperación con reintento (máx. 2), reescritura de consulta y ramas condicionales."""

from __future__ import annotations

import os
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from supabase import Client

from agent.gemini_rag import answer_with_gemini, rewrite_query_for_retrieval
from agent.persistence import insert_agent_step
from agent.tracing import traced_graph_node
from rag.match_chunks import match_document_chunks


class AgentGraphState(TypedDict, total=False):
    tenant_id: str
    message: str
    effective_query: str
    retrieval_count: int
    matches: list[dict[str, Any]]
    answer: str
    citations: list[dict[str, Any]]


def _read_float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _read_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _compact_match_payload(m: dict[str, Any]) -> dict[str, Any]:
    body = str(m.get("body") or "")
    snippet = body[:280] + ("…" if len(body) > 280 else "")
    return {
        "chunk_id": str(m.get("chunk_id", "")),
        "document_id": str(m.get("document_id", "")),
        "heading_path": str(m.get("heading_path") or ""),
        "similarity": float(m.get("similarity") or 0.0),
        "snippet": snippet or None,
    }


def _context_ok(matches: list[dict[str, Any]], *, min_best_similarity: float) -> bool:
    if not matches:
        return False
    best = max(float(m.get("similarity") or 0.0) for m in matches)
    return best >= min_best_similarity


def build_agent_graph(
    client: Client,
    run_id: str,
    *,
    gemini_api_key: str,
    langsmith_parent: Any | None = None,
) -> Any:
    """Compila el grafo con routing condicional y hasta dos recuperaciones semánticas."""
    min_rpc_sim = _read_float("AGENT_MIN_SIMILARITY", 0.22)
    min_ok_sim = _read_float("AGENT_CONTEXT_OK_MIN_SIMILARITY", 0.24)
    match_count = _read_int("AGENT_MATCH_COUNT", 10)
    max_attempts = min(2, max(1, _read_int("AGENT_MAX_RETRIEVAL_ATTEMPTS", 2)))

    step_idx = [0]

    def _next_step_index() -> int:
        step_idx[0] += 1
        return step_idx[0]

    def retrieve(state: AgentGraphState) -> dict[str, Any]:
        q = (state.get("effective_query") or state.get("message") or "").strip()
        if not q:
            q = str(state.get("message") or "")
        n_prev = int(state.get("retrieval_count") or 0)
        if n_prev >= max_attempts:
            return {"matches": [], "retrieval_count": n_prev}

        with traced_graph_node(
            langsmith_parent,
            name="agent.retrieve",
            inputs={
                "query_preview": q[:500],
                "attempt": n_prev + 1,
                "match_count": match_count,
                "min_similarity": min_rpc_sim,
            },
        ) as (_, holder):
            matches = match_document_chunks(
                client,
                tenant_id=state["tenant_id"],
                query=q,
                match_count=match_count,
                min_similarity=min_rpc_sim,
                api_key=gemini_api_key,
            )
            payload = {
                "match_count_requested": match_count,
                "min_similarity": min_rpc_sim,
                "query_preview": q[:400],
                "matches": [_compact_match_payload(m) for m in matches[:24]],
            }
            insert_agent_step(
                client,
                run_id=run_id,
                step_key="retrieve",
                step_index=_next_step_index(),
                payload=payload,
            )
            best = max((float(m.get("similarity") or 0) for m in matches), default=0.0)
            holder["outputs"] = {
                "retrieved": len(matches),
                "best_similarity": best,
            }
        return {"matches": matches, "retrieval_count": n_prev + 1}

    def route_after_retrieve(
        state: AgentGraphState,
    ) -> Literal["generate", "rewrite_query", "respond_no_context"]:
        matches = list(state.get("matches") or [])
        if _context_ok(matches, min_best_similarity=min_ok_sim):
            return "generate"
        n = int(state.get("retrieval_count") or 0)
        if n < max_attempts:
            return "rewrite_query"
        return "respond_no_context"

    def rewrite_query(state: AgentGraphState) -> dict[str, Any]:
        with traced_graph_node(
            langsmith_parent,
            name="agent.rewrite_query",
            inputs={"message_preview": str(state.get("message") or "")[:500]},
        ) as (_, holder):
            raw_msg = str(state.get("message") or "")
            new_q = rewrite_query_for_retrieval(raw_msg, api_key=gemini_api_key).strip()
            if not new_q:
                new_q = raw_msg.strip() or raw_msg
            insert_agent_step(
                client,
                run_id=run_id,
                step_key="rewrite_query",
                step_index=_next_step_index(),
                payload={"rewritten_preview": new_q[:400]},
            )
            holder["outputs"] = {"rewritten_len": len(new_q)}
        return {"effective_query": new_q}

    def respond_no_context(state: AgentGraphState) -> dict[str, Any]:
        with traced_graph_node(
            langsmith_parent,
            name="agent.respond_no_context",
            inputs={"retrieval_count": int(state.get("retrieval_count") or 0)},
        ) as (_, holder):
            text = (
                "No hay fragmentos indexados con similitud suficiente en este espacio. "
                "Probá subir o indexar documentos Markdown."
            )
            best = max(
                (float(m.get("similarity") or 0) for m in (state.get("matches") or [])),
                default=0.0,
            )
            insert_agent_step(
                client,
                run_id=run_id,
                step_key="respond_no_context",
                step_index=_next_step_index(),
                payload={
                    "reason": "low_similarity_or_empty",
                    "best_similarity": best,
                    "min_ok_similarity": min_ok_sim,
                },
            )
            holder["outputs"] = {"strategy": "no_context"}
        return {"answer": text, "citations": []}

    def generate(state: AgentGraphState) -> dict[str, Any]:
        with traced_graph_node(
            langsmith_parent,
            name="agent.generate",
            inputs={"citation_candidates": len(state.get("matches") or [])},
        ) as (_, holder):
            text, cites = answer_with_gemini(
                str(state.get("message") or ""),
                list(state.get("matches") or []),
                api_key=gemini_api_key,
            )
            insert_agent_step(
                client,
                run_id=run_id,
                step_key="generate",
                step_index=_next_step_index(),
                payload={
                    "model": "gemini-2.0-flash",
                    "citations_count": len(cites),
                },
            )
            holder["outputs"] = {
                "answer_chars": len(text),
                "citations_count": len(cites),
            }
        return {"answer": text, "citations": cites}

    g = StateGraph(AgentGraphState)
    g.add_node("retrieve", retrieve)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("respond_no_context", respond_no_context)
    g.add_node("generate", generate)
    g.add_edge(START, "retrieve")
    g.add_conditional_edges(
        "retrieve",
        route_after_retrieve,
        {
            "generate": "generate",
            "rewrite_query": "rewrite_query",
            "respond_no_context": "respond_no_context",
        },
    )
    g.add_edge("rewrite_query", "retrieve")
    g.add_edge("generate", END)
    g.add_edge("respond_no_context", END)
    return g.compile()
