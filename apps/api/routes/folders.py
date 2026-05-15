"""Endpoints /v1/tenants/.../folders: CRUD de carpetas + listado combinado (carpetas + docs).

Fase 10: jerarquía de carpetas para el explorador de archivos tipo Obsidian.
El árbol lógico vive en `document_folders`; los documentos tienen `folder_id` (NULL = raíz).
"""

from __future__ import annotations

import uuid
from typing import Any

from flask import Blueprint, jsonify, request

from audit_log import record_audit
from routes.documents import EDITOR_ROLES
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("folders", __name__, url_prefix="/v1")


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _collect_descendant_ids(
    client: Any,
    tenant_id: str,
    folder_id: str,
) -> set[str]:
    """BFS para obtener todos los IDs de subcarpetas de `folder_id` dentro del tenant."""
    visited: set[str] = set()
    queue = [folder_id]
    while queue:
        current = queue.pop()
        res = (
            client.table("document_folders")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("parent_id", current)
            .execute()
        )
        for row in res.data or []:
            child_id = str(row["id"])
            if child_id not in visited:
                visited.add(child_id)
                queue.append(child_id)
    return visited


def _is_descendant_or_self(
    client: Any,
    tenant_id: str,
    folder_id: str,
    candidate: str,
) -> bool:
    """Devuelve True si candidate es igual a folder_id o es descendiente suyo."""
    if folder_id == candidate:
        return True
    return candidate in _collect_descendant_ids(client, tenant_id, folder_id)


def _count_direct_children(client: Any, tenant_id: str, folder_id: str) -> int:
    """Cuenta hijos directos (subcarpetas + docs) de una carpeta."""
    folders_res = (
        client.table("document_folders")
        .select("id", count="exact")
        .eq("tenant_id", tenant_id)
        .eq("parent_id", folder_id)
        .execute()
    )
    docs_res = (
        client.table("documents")
        .select("id", count="exact")
        .eq("tenant_id", tenant_id)
        .eq("folder_id", folder_id)
        .execute()
    )
    folder_count = (folders_res.count or 0) if folders_res else 0
    docs_count = (docs_res.count or 0) if docs_res else 0
    return folder_count + docs_count


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@bp.get("/tenants/<tenant_id>/folders")
def list_tree(tenant_id: str):
    """Devuelve todas las carpetas + documentos del tenant en listas planas.

    El cliente construye el árbol a partir de `parent_id` y `folder_id`.
    """
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

    folders_res = (
        client.table("document_folders")
        .select("id, parent_id, name, created_by, created_at, updated_at")
        .eq("tenant_id", tenant_id)
        .order("name")
        .execute()
    )
    docs_res = (
        client.table("documents")
        .select(
            "id, folder_id, title, mime_type, size_bytes, "
            "index_status, created_by, created_at, updated_at"
        )
        .eq("tenant_id", tenant_id)
        .order("title")
        .execute()
    )

    return jsonify(
        {
            "folders": folders_res.data or [],
            "documents": docs_res.data or [],
        }
    ), 200


@bp.post("/tenants/<tenant_id>/folders")
def create_folder(tenant_id: str):
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

    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name or len(name) > 120:
        return jsonify({"error": "name inválido (1–120 caracteres)"}), 400

    parent_id = body.get("parent_id") or None
    if parent_id:
        pid, err = parse_uuid(str(parent_id), "parent_id")
        if err:
            return err
        parent_id = pid
        # Verificar que la carpeta padre pertenece al mismo tenant.
        chk = (
            client.table("document_folders")
            .select("id")
            .eq("id", parent_id)
            .eq("tenant_id", tenant_id)
            .limit(1)
            .execute()
        )
        if not (chk.data or []):
            return jsonify({"error": "Carpeta padre no encontrada"}), 404

    folder_id = str(uuid.uuid4())
    row = {
        "id": folder_id,
        "tenant_id": tenant_id,
        "parent_id": parent_id,
        "name": name,
        "created_by": user_id,
    }

    try:
        ins = client.table("document_folders").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)
        if "unique" in detail.lower() or "duplicate" in detail.lower():
            return jsonify({"error": "Ya existe una carpeta con ese nombre aquí"}), 409
        return jsonify({"error": "Fallo al crear carpeta", "detail": detail}), 502

    final = (ins.data or [row])[0]

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="folder.created",
        payload={"folder_id": folder_id, "name": name, "parent_id": parent_id},
    )

    return jsonify(final), 201


@bp.patch("/tenants/<tenant_id>/folders/<folder_id>")
def update_folder(tenant_id: str, folder_id: str):
    """Rename y/o move de una carpeta. Rechaza si generaría un ciclo."""
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    fid, err = parse_uuid(folder_id, "folder_id")
    if err:
        return err
    folder_id = fid

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    existing_res = (
        client.table("document_folders")
        .select("id, parent_id, name")
        .eq("id", folder_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (existing_res.data or []):
        return jsonify({"error": "Carpeta no encontrada"}), 404

    body = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}

    if "name" in body:
        name = (body["name"] or "").strip()
        if not name or len(name) > 120:
            return jsonify({"error": "name inválido (1–120 caracteres)"}), 400
        updates["name"] = name

    if "parent_id" in body:
        new_parent = body["parent_id"] or None
        if new_parent:
            pid, err = parse_uuid(str(new_parent), "parent_id")
            if err:
                return err
            new_parent = pid
            # Evitar ciclo: no mover a sí misma ni a un descendiente.
            if new_parent == folder_id or _is_descendant_or_self(
                client, tenant_id, folder_id, new_parent
            ):
                return jsonify(
                    {"error": "No se puede mover una carpeta a sí misma o a un descendiente"}
                ), 400
            # Verificar que la nueva carpeta padre es del mismo tenant.
            chk = (
                client.table("document_folders")
                .select("id")
                .eq("id", new_parent)
                .eq("tenant_id", tenant_id)
                .limit(1)
                .execute()
            )
            if not (chk.data or []):
                return jsonify({"error": "Carpeta padre no encontrada"}), 404
        updates["parent_id"] = new_parent

    if not updates:
        return jsonify({"error": "Sin campos a actualizar (name, parent_id)"}), 400

    try:
        up = (
            client.table("document_folders")
            .update(updates)
            .eq("id", folder_id)
            .eq("tenant_id", tenant_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)
        if "unique" in detail.lower() or "duplicate" in detail.lower():
            return jsonify({"error": "Ya existe una carpeta con ese nombre aquí"}), 409
        return jsonify({"error": "Fallo al actualizar carpeta", "detail": detail}), 502

    final = (up.data or [{"id": folder_id, **updates}])[0]

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="folder.updated",
        payload={"folder_id": folder_id, **{k: str(v) if v else v for k, v in updates.items()}},
    )

    return jsonify(final), 200


@bp.delete("/tenants/<tenant_id>/folders/<folder_id>")
def delete_folder(tenant_id: str, folder_id: str):
    """Borra carpeta. Rechaza con 409 si tiene hijos directos (fuerza confirmación en UI)."""
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    fid, err = parse_uuid(folder_id, "folder_id")
    if err:
        return err
    folder_id = fid

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    existing_res = (
        client.table("document_folders")
        .select("id, name")
        .eq("id", folder_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (existing_res.data or []):
        return jsonify({"error": "Carpeta no encontrada"}), 404

    # Forzar confirmación si tiene items directos.
    force = str(request.args.get("force", "")).lower() in ("1", "true", "yes")
    if not force:
        count = _count_direct_children(client, tenant_id, folder_id)
        if count > 0:
            return jsonify(
                {
                    "error": "La carpeta tiene contenido",
                    "children_count": count,
                    "hint": "Agregá ?force=true para eliminar la carpeta y todo su contenido",
                }
            ), 409

    try:
        client.table("document_folders").delete().eq("id", folder_id).eq(
            "tenant_id", tenant_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al eliminar carpeta", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="folder.deleted",
        payload={"folder_id": folder_id},
    )

    return ("", 204)
