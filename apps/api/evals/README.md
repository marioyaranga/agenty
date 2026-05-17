# Evals — workyAI agent

Golden test set para detectar regresiones entre fases del refactor del agente.

## Setup rápido

```bash
# Activar venv (desde apps/api/)
.venv\Scripts\activate

# Instalar dependencias del runner (si no están)
pip install httpx pyyaml

# Setear variables
$env:EVAL_API_URL = "https://workyai-api.onrender.com"
$env:EVAL_JWT     = "<JWT de Supabase — copiar desde DevTools o Supabase Studio>"
$env:EVAL_TENANT_ID = "<UUID del tenant>"
```

## Cómo obtener el JWT

1. Abrir la app en el browser: https://agenty-delta.vercel.app
2. DevTools → Application → Cookies o Network → cualquier request a la API → header `Authorization`
3. Copiar el token (sin el `Bearer `)

El token dura ~1 hora. Para evals largos, renovarlo.

## Correr todos los casos

```bash
python evals/runner.py
```

## Correr solo algunos archivos

```bash
python evals/runner.py --cases seo_tools,edge_cases
```

## Filtrar por tag

```bash
python evals/runner.py --tags seo
python evals/runner.py --tags read_internal,no_tool
```

## Output verbose (muestra tools llamadas aunque pase)

```bash
python evals/runner.py --verbose
```

## Salida de ejemplo

```
Ejecutando 34 casos contra https://workyai-api.onrender.com

  [✓] docs_crud/list_folder_root  (2.3s)
  [✓] docs_crud/create_folder  (1.8s)
  [✗] seo_tools/search_volume_single_keyword  (4.1s)
      FALLA: Tool esperada 'tool_seo_search_volume' no fue llamada. Llamadas: []
  [!] edge_cases/empty_message  (0.1s)
      ERROR: HTTP 400: {"error": "message is required"}

──────────────────────────────────────────────────
Total: 34 | ✓ 30 | ✗ 2 | ! 1 | - 1
Reporte guardado en: evals/results/eval_20260516T143022.json
```

Exit code `0` = todo pasó. Exit code `1` = hay fallos o errores.

## Estructura de los casos YAML

```yaml
cases:
  - id: nombre_unico_del_caso
    description: Qué está probando este caso
    prompt: "El mensaje que se envía al agente"
    expected_tools: [tool_seo_search_volume]   # tools que deben haberse llamado
    expected_behavior: Descripción legible del resultado esperado
    expected_steps: [retrieve]                 # nodos del grafo esperados
    expected_done_fields: [run_id, answer]     # campos que deben estar en el evento done
    expected_web_sources: true                 # si debe haber web_sources en done
    expected_first_event: started              # tipo del primer evento SSE
    expect_error_or_done: true                 # acepta tanto error como done
    web_grounding_enabled: true                # sobreescribe el default del tenant
    thread_requires_prior_turn: true           # enviar un turno previo primero
    prior_prompt: "Turno anterior"             # mensaje del turno previo
    tags: [seo, read_external]
    skip: true                                 # omitir este caso
    cleanup_hint: Borrar recurso X después     # recordatorio manual
```

## Agregar un caso nuevo

1. Abrí el archivo `.yaml` más relevante en `cases/`
2. Agregá tu caso al array `cases:`
3. Corré solo ese archivo para verificar: `python evals/runner.py --cases <nombre>`

## Cuándo correr los evals

- **Antes de empezar una fase** de refactor (capturar baseline)
- **Después de terminar una fase** (verificar que no hay regresiones)
- Los reportes JSON en `results/` quedan como historial (ignorados por git)

## Notas

- Los casos de escritura (`create_folder`, `create_document`) crean recursos reales en el workspace del tenant. Ver el campo `cleanup_hint` en el caso para saber qué borrar.
- Los casos `multi_turn` necesitan que el thread del turno anterior esté disponible; el runner lo maneja automáticamente con `thread_requires_prior_turn: true` + `prior_prompt`.
- El directorio `results/` está en `.gitignore` — los reportes no se commitean.
