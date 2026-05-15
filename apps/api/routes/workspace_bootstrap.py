"""Endpoint POST /v1/tenants/<tid>/bootstrap-defaults: siembra carpeta y archivos
por defecto en workspaces nuevos o recién migrados.

Idempotente: usa `tenants.defaults_seeded_at` como bandera atómica (UPDATE … WHERE
defaults_seeded_at IS NULL RETURNING id). Un segundo request devuelve 200 already_seeded
sin tocar nada más.

Reutiliza tool_create_folder / tool_create_document de agent/tools.py para garantizar
la misma lógica de Storage + DB + auditoría que el agente.
"""

from __future__ import annotations

from flask import Blueprint, jsonify

from agent.tools import tool_create_document, tool_create_folder
from audit_log import record_audit
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("workspace_bootstrap", __name__, url_prefix="/v1")

EDITOR_ROLES = frozenset({"editor", "admin", "owner"})

_WELCOME_MD = """\
# Bienvenido a tu espacio de trabajo

Este es tu primer documento Markdown. Podés editarlo, renombrarlo o moverlo a otra carpeta
usando el menú contextual (clic derecho) del explorador de archivos de la barra lateral.

## ¿Cómo empezar?

- **Crear documentos**: hacé clic en el ícono de archivo nuevo en la barra lateral.
- **Organizar en carpetas**: creá carpetas con el ícono de carpeta nueva y arrastrá archivos.
- **Agente de IA**: abrí el chat del agente para pedirle que cree o edite documentos por vos.

Los archivos Markdown se indexan automáticamente para búsqueda semántica, así que el agente
puede encontrar contenido relevante dentro de tus documentos al responder preguntas.
"""

_WELCOME_HTML = """\
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Guía rápida</title>
</head>
<body>
  <h1>Guía rápida de workyAI</h1>
  <p>
    Este archivo HTML de ejemplo muestra que el explorador soporta múltiples
    tipos de archivo. Podés subir o crear archivos <code>.md</code>,
    <code>.html</code> y <code>.txt</code>.
  </p>
  <h2>Acciones disponibles</h2>
  <ul>
    <li>Renombrar: clic derecho → Renombrar</li>
    <li>Mover: arrastrá el archivo a otra carpeta</li>
    <li>Eliminar: clic derecho → Eliminar</li>
    <li>Ver contenido: clic simple sobre el archivo</li>
  </ul>
  <p>
    Los archivos HTML no se indexan para RAG, pero el agente puede crearlos
    y editarlos igual que los Markdown.
  </p>
</body>
</html>
"""


@bp.post("/tenants/<tenant_id>/bootstrap-defaults")
def bootstrap_defaults(tenant_id: str):
    """Siembra carpeta Bienvenida + README.md + guia.html si el workspace aún no fue inicializado."""
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
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    # Intentar tomar la bandera atómicamente. Si ya estaba seteada → ya fue sembrado.
    try:
        claim = (
            client.table("tenants")
            .update({"defaults_seeded_at": "now()"})
            .eq("id", tenant_id)
            .is_("defaults_seeded_at", "null")
            .select("id")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Error al verificar estado", "detail": str(exc)}), 502

    if not (claim.data or []):
        return jsonify({"status": "already_seeded"}), 200

    # Workspace recién reclamado: sembrar carpeta y archivos.
    folder_result = tool_create_folder(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        name="Bienvenida",
    )
    if not folder_result.get("ok"):
        _rollback_flag(client, tenant_id)
        return jsonify({"error": "No se pudo crear la carpeta", "detail": folder_result.get("error")}), 502

    folder_id = folder_result["folder_id"]
    seeded_docs: list[dict] = []

    md_result = tool_create_document(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        title="README.md",
        content=_WELCOME_MD,
        folder_id=folder_id,
        mime_type="text/markdown",
    )
    if not md_result.get("ok"):
        _rollback_flag(client, tenant_id)
        return jsonify({"error": "No se pudo crear README.md", "detail": md_result.get("error")}), 502
    seeded_docs.append({"id": md_result["document_id"], "title": "README.md", "mime_type": "text/markdown"})

    html_result = tool_create_document(
        client,
        tenant_id=tenant_id,
        user_id=user_id,
        title="guia.html",
        content=_WELCOME_HTML,
        folder_id=folder_id,
        mime_type="text/html",
    )
    if not html_result.get("ok"):
        _rollback_flag(client, tenant_id)
        return jsonify({"error": "No se pudo crear guia.html", "detail": html_result.get("error")}), 502
    seeded_docs.append({"id": html_result["document_id"], "title": "guia.html", "mime_type": "text/html"})

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="workspace.defaults_seeded",
        payload={"folder_id": folder_id, "documents": [d["id"] for d in seeded_docs]},
    )

    return jsonify({"status": "seeded", "folder_id": folder_id, "documents": seeded_docs}), 201


def _rollback_flag(client, tenant_id: str) -> None:
    try:
        client.table("tenants").update({"defaults_seeded_at": None}).eq("id", tenant_id).execute()
    except Exception:  # noqa: BLE001
        pass
