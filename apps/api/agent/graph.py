"""Grafo LangGraph mínimo: retrieve → generate."""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from supabase import Client

from agent.gemini_rag import answer_with_gemini
from agent.persistence import insert_agent_step
from rag.match_chunks import match_document_chunks


class AgentGraphState(TypedDict, total=False):
    tenant_id: str
    message: str
    matches: list[dict[str, Any]]
    answer: str
    citations: list[dict[str, Any]]


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


def build_agent_graph(client: Client, run_id: str) -> Any:
    """Compila el grafo con `run_id` y cliente Supabase cerrados en el closure."""

    def retrieve(state: AgentGraphState) -> dict[str, Any]:
        matches = match_document_chunks(
            client,
            tenant_id=state["tenant_id"],
            query=state["message"],
            match_count=10,
            min_similarity=0.22,
        )
        payload = {
            "match_count_requested": 10,
            "min_similarity": 0.22,
            "matches": [_compact_match_payload(m) for m in matches[:24]],
        }
        insert_agent_step(
            client,
            run_id=run_id,
            step_key="retrieve",
            step_index=1,
            payload=payload,
        )
        return {"matches": matches}

    def generate(state: AgentGraphState) -> dict[str, Any]:
        text, cites = answer_with_gemini(state["message"], state.get("matches") or [])
        insert_agent_step(
            client,
            run_id=run_id,
            step_key="generate",
            step_index=2,
            payload={
                "model": "gemini-2.0-flash",
                "citations_count": len(cites),
            },
        )
        return {"answer": text, "citations": cites}

    g = StateGraph(AgentGraphState)
    g.add_node("retrieve", retrieve)
    g.add_node("generate", generate)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "generate")
    g.add_edge("generate", END)
    return g.compile()
