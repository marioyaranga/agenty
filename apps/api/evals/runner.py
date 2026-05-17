"""
Eval runner para workyAI agent.

Uso:
    python evals/runner.py [--cases seo_tools,docs_crud] [--tags seo] [--report results/]

Variables de entorno requeridas:
    EVAL_API_URL     URL base de la API, ej: https://workyai-api.onrender.com
    EVAL_JWT         JWT de Supabase válido (Bearer token)
    EVAL_TENANT_ID   UUID del tenant contra el que corren los evals

Opcionales:
    EVAL_THREAD_ID   Thread fijo para multi-turn (si no se setea, crea uno nuevo por caso)
    EVAL_TIMEOUT     Segundos de timeout por caso (default: 60)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

ROOT = Path(__file__).parent
CASES_DIR = ROOT / "cases"
RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(exist_ok=True)

API_URL = os.environ.get("EVAL_API_URL", "").rstrip("/")
JWT = os.environ.get("EVAL_JWT", "")
TENANT_ID = os.environ.get("EVAL_TENANT_ID", "")
TIMEOUT = int(os.environ.get("EVAL_TIMEOUT", "60"))


def _check_env():
    missing = [v for v in ("EVAL_API_URL", "EVAL_JWT", "EVAL_TENANT_ID") if not os.environ.get(v)]
    if missing:
        print(f"ERROR: Faltan variables de entorno: {', '.join(missing)}")
        sys.exit(1)


def _load_cases(filter_files: list[str] | None, filter_tags: list[str] | None) -> list[dict]:
    cases = []
    for path in sorted(CASES_DIR.glob("*.yaml")):
        if filter_files and path.stem not in filter_files:
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        for case in data.get("cases", []):
            case["_file"] = path.stem
            if filter_tags:
                case_tags = case.get("tags", [])
                if not any(t in case_tags for t in filter_tags):
                    continue
            cases.append(case)
    return cases


def _parse_sse_stream(response: httpx.Response) -> list[dict]:
    events = []
    for line in response.iter_lines():
        if line.startswith("data: "):
            raw = line[6:]
            try:
                events.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return events


def _run_case(case: dict, prior_thread_id: str | None = None) -> dict:
    if case.get("skip"):
        return {"status": "skip", "reason": case.get("skip_reason", "marcado skip")}

    body: dict[str, Any] = {"message": case["prompt"]}

    web_grounding = case.get("web_grounding_enabled")
    if web_grounding is not None:
        body["web_grounding_enabled"] = web_grounding

    if prior_thread_id:
        body["thread_id"] = prior_thread_id

    url = f"{API_URL}/v1/tenants/{TENANT_ID}/agent/chat"
    headers = {
        "Authorization": f"Bearer {JWT}",
        "X-Tenant-Id": TENANT_ID,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    start = time.monotonic()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            with client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code != 200:
                    return {
                        "status": "error",
                        "reason": f"HTTP {resp.status_code}: {resp.read().decode()[:300]}",
                        "elapsed": time.monotonic() - start,
                    }
                events = _parse_sse_stream(resp)
    except httpx.TimeoutException:
        return {"status": "error", "reason": f"Timeout después de {TIMEOUT}s", "elapsed": TIMEOUT}
    except Exception as exc:
        return {"status": "error", "reason": str(exc), "elapsed": time.monotonic() - start}

    elapsed = time.monotonic() - start
    return _evaluate(case, events, elapsed)


def _evaluate(case: dict, events: list[dict], elapsed: float) -> dict:
    result: dict[str, Any] = {"elapsed": round(elapsed, 2), "events": events, "failures": []}

    # Extraer datos de los eventos
    types_seen = [e.get("type") for e in events]
    tools_called = [e.get("tool_name") for e in events if e.get("type") == "tool" and e.get("status") == "running"]
    done_event = next((e for e in events if e.get("type") == "done"), None)
    error_event = next((e for e in events if e.get("type") == "error"), None)
    steps_seen = [e.get("node") for e in events if e.get("type") == "step"]

    result["tools_called"] = tools_called
    result["has_done"] = done_event is not None
    result["has_error"] = error_event is not None
    result["thread_id"] = (done_event or error_event or {}).get("thread_id")
    result["run_id"] = (done_event or error_event or {}).get("run_id")

    # Verificación: primer evento debe ser 'started'
    if case.get("expected_first_event"):
        expected_first = case["expected_first_event"]
        actual_first = types_seen[0] if types_seen else None
        if actual_first != expected_first:
            result["failures"].append(
                f"Primer evento esperado '{expected_first}', got '{actual_first}'"
            )

    # Verificación: si se espera error o done
    if case.get("expect_error_or_done"):
        if not done_event and not error_event:
            result["failures"].append("No llegó ningún evento 'done' ni 'error'")
    else:
        if not done_event and not error_event:
            result["failures"].append("Stream terminó sin evento 'done' ni 'error'")

    # Verificación: tools esperadas
    expected_tools = case.get("expected_tools", [])
    for tool in expected_tools:
        if tool not in tools_called:
            result["failures"].append(f"Tool esperada '{tool}' no fue llamada. Llamadas: {tools_called}")

    # Verificación: sin tools inesperadas (solo si expected_tools es lista vacía explícita)
    if "expected_tools" in case and expected_tools == [] and tools_called:
        result["failures"].append(f"Se esperaba 0 tools pero se llamaron: {tools_called}")

    # Verificación: steps esperados
    for step in case.get("expected_steps", []):
        if step not in steps_seen:
            result["failures"].append(f"Step esperado '{step}' no apareció en el stream. Steps vistos: {steps_seen}")

    # Verificación: campos del evento done
    for field in case.get("expected_done_fields", []):
        if done_event and not done_event.get(field):
            result["failures"].append(f"Evento 'done' le falta el campo '{field}'")

    # Verificación: web sources
    if "expected_web_sources" in case:
        web_sources = (done_event or {}).get("web_sources", [])
        if case["expected_web_sources"] and not web_sources:
            result["failures"].append("Se esperaban web_sources pero el evento 'done' no tiene ninguno")
        elif not case["expected_web_sources"] and web_sources:
            result["failures"].append(f"Se esperaba 0 web_sources pero llegaron {len(web_sources)}")

    result["status"] = "pass" if not result["failures"] else "fail"
    return result


def _print_result(case: dict, result: dict, verbose: bool):
    icon = {"pass": "✓", "fail": "✗", "error": "!", "skip": "-"}.get(result["status"], "?")
    elapsed = result.get("elapsed", 0)
    print(f"  [{icon}] {case['_file']}/{case['id']}  ({elapsed:.1f}s)")
    if verbose or result["status"] in ("fail", "error"):
        if result.get("tools_called"):
            print(f"      tools: {result['tools_called']}")
        for f in result.get("failures", []):
            print(f"      FALLA: {f}")
        if result.get("reason"):
            print(f"      ERROR: {result['reason']}")


def main():
    _check_env()

    parser = argparse.ArgumentParser(description="Eval runner de workyAI agent")
    parser.add_argument("--cases", help="Archivos de casos separados por coma (sin .yaml)")
    parser.add_argument("--tags", help="Filtrar por tags separados por coma")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--report", default=str(RESULTS_DIR), help="Directorio donde guardar el reporte JSON")
    args = parser.parse_args()

    filter_files = args.cases.split(",") if args.cases else None
    filter_tags = args.tags.split(",") if args.tags else None

    cases = _load_cases(filter_files, filter_tags)
    if not cases:
        print("No se encontraron casos con los filtros dados.")
        sys.exit(0)

    print(f"\nEjecutando {len(cases)} casos contra {API_URL}\n")

    results = []
    thread_registry: dict[str, str] = {}  # case_id → thread_id para multi-turn

    for case in cases:
        prior_thread = None
        if case.get("thread_requires_prior_turn"):
            prior_id = case.get("prior_case_id", "")
            prior_thread = thread_registry.get(prior_id)
            if not prior_thread:
                prior_case = {
                    "_file": case["_file"],
                    "id": f"{case['id']}__prior",
                    "prompt": case.get("prior_prompt", ""),
                    "expected_tools": [],
                }
                prior_result = _run_case(prior_case)
                prior_thread = prior_result.get("thread_id")

        result = _run_case(case, prior_thread_id=prior_thread)
        if result.get("thread_id"):
            thread_registry[case["id"]] = result["thread_id"]

        results.append({"case": case, "result": result})
        _print_result(case, result, args.verbose)

    # Resumen
    totals = {"pass": 0, "fail": 0, "error": 0, "skip": 0}
    for r in results:
        totals[r["result"]["status"]] = totals.get(r["result"]["status"], 0) + 1

    print(f"\n{'-' * 50}")
    print(f"Total: {len(results)} | ✓ {totals['pass']} | ✗ {totals['fail']} | ! {totals['error']} | - {totals['skip']}")

    # Guardar reporte
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    report_path = Path(args.report) / f"eval_{ts}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(
            {"timestamp": ts, "api_url": API_URL, "tenant_id": TENANT_ID, "totals": totals, "results": results},
            f,
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    print(f"Reporte guardado en: {report_path}\n")

    sys.exit(0 if totals["fail"] == 0 and totals["error"] == 0 else 1)


if __name__ == "__main__":
    main()
