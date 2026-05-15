"""Tools del agente para CRUD de carpetas y documentos.

Cada función pura aplica el gate de rol (editor+) antes de mutar.
El grafo de LangGraph las invoca vía Gemini function calling.
"""

from __future__ import annotations

import uuid
from typing import Any

from supabase import Client

from agent.seo_tools import tool_seo_keywords_for_url, tool_seo_search_volume, tool_seo_serp_organic
from audit_log import record_audit
from notifications import notify_document_index_outcome
from postgrest_utils import first_dict_from_execute
from rag.index_document import (
    is_real_markdown,
    sync_index_markdown_document,
    truncate_index_error,
)
from routes.documents import (
    ALLOWED_EXTENSIONS,
    BUCKET_ID,
    EDITOR_ROLES,
    _index_status_for_mime,
    _max_upload_bytes,
    _sanitize_storage_filename,
)
from storage3.exceptions import StorageApiError
from tenant_http import membership_role


def _check_editor_role(
    client: Client, tenant_id: str, user_id: str
) -> str | None:
    """Devuelve None si el usuario tiene rol editor+; mensaje de error si no."""
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return "El usuario no tiene permiso de edición en este espacio"
    return None


# ---------------------------------------------------------------------------
# Tool: crear carpeta
# ---------------------------------------------------------------------------

def tool_create_folder(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    name: str,
    parent_id: str | None = None,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    name = (name or "").strip()
    if not name or len(name) > 120:
        return {"ok": False, "error": "name inválido (1–120 caracteres)"}

    if parent_id:
        chk = (
            client.table("document_folders")
            .select("id")
            .eq("id", parent_id)
            .eq("tenant_id", tenant_id)
            .limit(1)
            .execute()
        )
        if not (chk.data or []):
            return {"ok": False, "error": "Carpeta padre no encontrada"}

    folder_id = str(uuid.uuid4())
    row: dict[str, Any] = {
        "id": folder_id,
        "tenant_id": tenant_id,
        "parent_id": parent_id or None,
        "name": name,
        "created_by": user_id,
    }
    try:
        ins = client.table("document_folders").insert(row).execute()
        final = (ins.data or [row])[0]
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Fallo al crear carpeta: {exc}"}

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.folder.created",
        payload={"folder_id": folder_id, "name": name, "parent_id": parent_id},
    )
    return {"ok": True, "folder_id": folder_id, "name": name}


# ---------------------------------------------------------------------------
# Tool: crear documento (contenido como string)
# ---------------------------------------------------------------------------

def tool_create_document(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    title: str,
    content: str = "",
    folder_id: str | None = None,
    mime_type: str = "text/markdown",
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    title = (title or "").strip()
    if not title or len(title) > 500:
        return {"ok": False, "error": "title inválido (1–500 caracteres)"}

    raw = (content or "").encode("utf-8")
    max_bytes = _max_upload_bytes()
    if len(raw) > max_bytes:
        return {"ok": False, "error": "Contenido demasiado grande"}

    mime = (mime_type or "text/markdown").split(";")[0].strip()

    document_id = str(uuid.uuid4())
    safe_name = _sanitize_storage_filename(title)
    storage_path = f"{tenant_id}/{document_id}/{safe_name}"
    storage = client.storage.from_(BUCKET_ID)
    try:
        storage.upload(
            storage_path,
            raw,
            file_options={"content-type": mime, "upsert": "false"},
        )
    except StorageApiError as exc:
        return {"ok": False, "error": f"Fallo al subir a Storage: {exc}"}

    row: dict[str, Any] = {
        "id": document_id,
        "tenant_id": tenant_id,
        "created_by": user_id,
        "title": title,
        "storage_path": storage_path,
        "mime_type": mime,
        "size_bytes": len(raw),
        "index_status": _index_status_for_mime(mime),
        "index_error": None,
    }
    if folder_id:
        row["folder_id"] = folder_id

    try:
        ins = client.table("documents").insert(row).execute()
        final_row: dict[str, Any] = (ins.data or [row])[0]
    except Exception as exc:  # noqa: BLE001
        try:
            storage.remove([storage_path])
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "error": f"Fallo al guardar metadatos: {exc}"}

    if str(final_row.get("index_status", "")) == "pending":
        status, idx_err = sync_index_markdown_document(
            client,
            tenant_id=tenant_id,
            document_id=document_id,
            storage_path=storage_path,
            mime_type=mime,
        )
        err_s = truncate_index_error(idx_err)
        try:
            up = (
                client.table("documents")
                .update({"index_status": status, "index_error": err_s})
                .eq("id", document_id)
                .eq("tenant_id", tenant_id)
                .execute()
            )
            updated = first_dict_from_execute(up)
            if updated:
                final_row = updated
        except Exception:  # noqa: BLE001
            pass

        notify_document_index_outcome(
            client,
            tenant_id=tenant_id,
            created_by=user_id,
            document_id=document_id,
            title=title,
            index_status=str(final_row.get("index_status", "")),
            index_error=str(final_row.get("index_error") or "") or None,
        )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.document.created",
        payload={"document_id": document_id, "title": title[:200]},
    )
    return {"ok": True, "document_id": document_id, "title": title}


# ---------------------------------------------------------------------------
# Tool: actualizar contenido de un documento
# ---------------------------------------------------------------------------

def tool_update_document_content(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    document_id: str,
    content: str,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    res = (
        client.table("documents")
        .select("id, title, storage_path, mime_type, created_by")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        return {"ok": False, "error": "Documento no encontrado"}

    doc = res.data[0]
    raw = (content or "").encode("utf-8")
    max_bytes = _max_upload_bytes()
    if len(raw) > max_bytes:
        return {"ok": False, "error": "Contenido demasiado grande"}

    mime = str(doc.get("mime_type") or "text/markdown")
    storage_path = str(doc["storage_path"])
    storage = client.storage.from_(BUCKET_ID)
    try:
        storage.upload(
            storage_path,
            raw,
            file_options={"content-type": mime, "upsert": "true"},
        )
    except StorageApiError as exc:
        return {"ok": False, "error": f"Fallo al actualizar Storage: {exc}"}

    meta: dict[str, Any] = {"size_bytes": len(raw)}
    if is_real_markdown(mime):
        meta["index_status"] = "pending"
        meta["index_error"] = None

    try:
        client.table("documents").update(meta).eq("id", document_id).eq(
            "tenant_id", tenant_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Fallo al actualizar metadatos: {exc}"}

    if is_real_markdown(mime):
        status, idx_err = sync_index_markdown_document(
            client,
            tenant_id=tenant_id,
            document_id=document_id,
            storage_path=storage_path,
            mime_type=mime,
        )
        err_s = truncate_index_error(idx_err)
        try:
            client.table("documents").update(
                {"index_status": status, "index_error": err_s}
            ).eq("id", document_id).eq("tenant_id", tenant_id).execute()
        except Exception:  # noqa: BLE001
            pass

        notify_document_index_outcome(
            client,
            tenant_id=tenant_id,
            created_by=str(doc.get("created_by") or "") or None,
            document_id=document_id,
            title=str(doc.get("title") or ""),
            index_status=status,
            index_error=err_s,
        )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.document.updated",
        payload={"document_id": document_id, "title": str(doc.get("title", ""))[:200]},
    )
    return {"ok": True, "document_id": document_id}


# ---------------------------------------------------------------------------
# Tool: renombrar documento o carpeta
# ---------------------------------------------------------------------------

def tool_rename(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    item_type: str,
    item_id: str,
    new_name: str,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    new_name = (new_name or "").strip()
    if not new_name:
        return {"ok": False, "error": "new_name es requerido"}

    table = "documents" if item_type == "document" else "document_folders"
    field = "title" if item_type == "document" else "name"
    max_len = 500 if item_type == "document" else 120

    if len(new_name) > max_len:
        return {"ok": False, "error": f"new_name demasiado largo (máx {max_len})"}

    try:
        up = (
            client.table(table)
            .update({field: new_name})
            .eq("id", item_id)
            .eq("tenant_id", tenant_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Fallo al renombrar: {exc}"}

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type=f"agent.{item_type}.renamed",
        payload={"item_id": item_id, "new_name": new_name[:200]},
    )
    return {"ok": True, "item_id": item_id, "new_name": new_name}


# ---------------------------------------------------------------------------
# Tool: mover documento o carpeta
# ---------------------------------------------------------------------------

def tool_move(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    item_type: str,
    item_id: str,
    new_parent_id: str | None,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    if item_type == "document":
        try:
            client.table("documents").update({"folder_id": new_parent_id}).eq(
                "id", item_id
            ).eq("tenant_id", tenant_id).execute()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"Fallo al mover: {exc}"}
    else:
        # Para carpetas verificar que no se crea ciclo (import local para evitar circular).
        if new_parent_id and new_parent_id == item_id:
            return {"ok": False, "error": "Una carpeta no puede ser su propio padre"}
        try:
            client.table("document_folders").update({"parent_id": new_parent_id}).eq(
                "id", item_id
            ).eq("tenant_id", tenant_id).execute()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"Fallo al mover carpeta: {exc}"}

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type=f"agent.{item_type}.moved",
        payload={"item_id": item_id, "new_parent_id": new_parent_id},
    )
    return {"ok": True, "item_id": item_id, "new_parent_id": new_parent_id}


# ---------------------------------------------------------------------------
# Tool: eliminar documento
# ---------------------------------------------------------------------------

def tool_delete_document(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    document_id: str,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    res = (
        client.table("documents")
        .select("id, storage_path")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        return {"ok": False, "error": "Documento no encontrado"}

    path = str(res.data[0]["storage_path"])
    try:
        client.storage.from_(BUCKET_ID).remove([path])
    except Exception:  # noqa: BLE001
        pass
    try:
        client.table("documents").delete().eq("id", document_id).eq(
            "tenant_id", tenant_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Fallo al borrar: {exc}"}

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.document.deleted",
        payload={"document_id": document_id},
    )
    return {"ok": True, "document_id": document_id}


# ---------------------------------------------------------------------------
# Tool: eliminar carpeta (solo si está vacía)
# ---------------------------------------------------------------------------

def tool_delete_folder(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    folder_id: str,
) -> dict[str, Any]:
    err = _check_editor_role(client, tenant_id, user_id)
    if err:
        return {"ok": False, "error": err}

    res = (
        client.table("document_folders")
        .select("id")
        .eq("id", folder_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        return {"ok": False, "error": "Carpeta no encontrada"}

    try:
        client.table("document_folders").delete().eq("id", folder_id).eq(
            "tenant_id", tenant_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Fallo al borrar carpeta: {exc}"}

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="agent.folder.deleted",
        payload={"folder_id": folder_id},
    )
    return {"ok": True, "folder_id": folder_id}


# ---------------------------------------------------------------------------
# Tool: listar contenido de una carpeta (o raíz)
# ---------------------------------------------------------------------------

def tool_list_folder(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    folder_id: str | None = None,
) -> dict[str, Any]:
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return {"ok": False, "error": "Sin acceso a este espacio"}

    try:
        folders_q = (
            client.table("document_folders")
            .select("id, name, parent_id")
            .eq("tenant_id", tenant_id)
        )
        folders_q = folders_q.eq("parent_id", folder_id) if folder_id else folders_q.is_("parent_id", "null")
        folders = (folders_q.order("name").limit(100).execute().data or [])
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error al listar carpetas: {exc}"}

    try:
        docs_q = (
            client.table("documents")
            .select("id, title, mime_type, size_bytes, index_status")
            .eq("tenant_id", tenant_id)
        )
        docs_q = docs_q.eq("folder_id", folder_id) if folder_id else docs_q.is_("folder_id", "null")
        docs = (docs_q.order("title").limit(200).execute().data or [])
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error al listar documentos: {exc}"}

    return {
        "ok": True,
        "folder_id": folder_id,
        "folders": [{"id": f["id"], "name": f["name"]} for f in folders],
        "documents": [
            {
                "id": d["id"],
                "title": d["title"],
                "mime_type": d.get("mime_type", ""),
                "size_bytes": d.get("size_bytes", 0),
                "index_status": d.get("index_status", ""),
            }
            for d in docs
        ],
        "folder_count": len(folders),
        "document_count": len(docs),
    }


# ---------------------------------------------------------------------------
# Tool: leer contenido completo de un documento
# ---------------------------------------------------------------------------

_READ_MAX_CHARS = 30_000


def tool_read_document(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    document_id: str,
) -> dict[str, Any]:
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return {"ok": False, "error": "Sin acceso a este espacio"}

    res = (
        client.table("documents")
        .select("id, title, storage_path, mime_type, size_bytes")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        return {"ok": False, "error": "Documento no encontrado"}

    doc = res.data[0]
    try:
        raw: bytes = client.storage.from_(BUCKET_ID).download(str(doc["storage_path"]))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error al descargar documento: {exc}"}

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="replace")

    truncated = len(content) > _READ_MAX_CHARS
    return {
        "ok": True,
        "document_id": document_id,
        "title": doc.get("title", ""),
        "mime_type": doc.get("mime_type", ""),
        "size_bytes": doc.get("size_bytes", 0),
        "content": content[:_READ_MAX_CHARS],
        "truncated": truncated,
    }


# ---------------------------------------------------------------------------
# Tool: buscar documentos por título
# ---------------------------------------------------------------------------

def tool_search_documents(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    query: str,
    folder_id: str | None = None,
) -> dict[str, Any]:
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return {"ok": False, "error": "Sin acceso a este espacio"}

    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "Se requiere query de búsqueda"}

    try:
        q = (
            client.table("documents")
            .select("id, title, mime_type, folder_id, size_bytes, index_status")
            .eq("tenant_id", tenant_id)
            .ilike("title", f"%{query}%")
        )
        if folder_id:
            q = q.eq("folder_id", folder_id)
        docs = (q.order("title").limit(20).execute().data or [])
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Error al buscar documentos: {exc}"}

    return {
        "ok": True,
        "query": query,
        "results": [
            {
                "id": d["id"],
                "title": d["title"],
                "mime_type": d.get("mime_type", ""),
                "folder_id": d.get("folder_id"),
                "size_bytes": d.get("size_bytes", 0),
                "index_status": d.get("index_status", ""),
            }
            for d in docs
        ],
        "result_count": len(docs),
    }


# ---------------------------------------------------------------------------
# Dispatcher: nombre de tool → función
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, Any] = {
    "tool_create_folder": tool_create_folder,
    "tool_create_document": tool_create_document,
    "tool_update_document_content": tool_update_document_content,
    "tool_rename": tool_rename,
    "tool_move": tool_move,
    "tool_delete_document": tool_delete_document,
    "tool_delete_folder": tool_delete_folder,
    "tool_list_folder": tool_list_folder,
    "tool_read_document": tool_read_document,
    "tool_search_documents": tool_search_documents,
    "tool_seo_search_volume": tool_seo_search_volume,
    "tool_seo_serp_organic": tool_seo_serp_organic,
    "tool_seo_keywords_for_url": tool_seo_keywords_for_url,
}


def dispatch_tool(
    client: Client,
    *,
    tenant_id: str,
    user_id: str,
    tool_name: str,
    tool_args: dict[str, Any],
) -> dict[str, Any]:
    fn = TOOL_REGISTRY.get(tool_name)
    if fn is None:
        return {"ok": False, "error": f"Tool desconocida: {tool_name}"}
    return fn(client, tenant_id=tenant_id, user_id=user_id, **tool_args)


# ---------------------------------------------------------------------------
# Declaraciones Gemini function calling
# ---------------------------------------------------------------------------

GEMINI_TOOL_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "tool_create_folder",
        "description": "Crea una nueva carpeta en el explorador de archivos del tenant.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nombre de la carpeta (1-120 chars)"},
                "parent_id": {
                    "type": "string",
                    "description": "UUID de la carpeta padre (omitir para raíz)",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "tool_create_document",
        "description": "Crea un documento Markdown o HTML en el explorador de archivos.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título / nombre del archivo"},
                "content": {"type": "string", "description": "Contenido del archivo en texto"},
                "folder_id": {
                    "type": "string",
                    "description": "UUID de la carpeta destino (omitir para raíz)",
                },
                "mime_type": {
                    "type": "string",
                    "description": "MIME del archivo (text/markdown o text/html)",
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "tool_update_document_content",
        "description": "Reemplaza el contenido de un documento existente y lo re-indexa si es Markdown.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "UUID del documento"},
                "content": {"type": "string", "description": "Nuevo contenido completo del archivo"},
            },
            "required": ["document_id", "content"],
        },
    },
    {
        "name": "tool_rename",
        "description": "Renombra un documento o carpeta.",
        "parameters": {
            "type": "object",
            "properties": {
                "item_type": {
                    "type": "string",
                    "enum": ["document", "folder"],
                    "description": "Tipo de item a renombrar",
                },
                "item_id": {"type": "string", "description": "UUID del item"},
                "new_name": {"type": "string", "description": "Nuevo nombre"},
            },
            "required": ["item_type", "item_id", "new_name"],
        },
    },
    {
        "name": "tool_move",
        "description": "Mueve un documento o carpeta a otra carpeta padre.",
        "parameters": {
            "type": "object",
            "properties": {
                "item_type": {
                    "type": "string",
                    "enum": ["document", "folder"],
                    "description": "Tipo de item a mover",
                },
                "item_id": {"type": "string", "description": "UUID del item"},
                "new_parent_id": {
                    "type": "string",
                    "description": "UUID de la carpeta destino (null para mover a raíz)",
                },
            },
            "required": ["item_type", "item_id"],
        },
    },
    {
        "name": "tool_delete_document",
        "description": "Elimina permanentemente un documento del explorador.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "UUID del documento a eliminar"},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "tool_delete_folder",
        "description": "Elimina una carpeta (y su contenido en cascada por la DB).",
        "parameters": {
            "type": "object",
            "properties": {
                "folder_id": {"type": "string", "description": "UUID de la carpeta a eliminar"},
            },
            "required": ["folder_id"],
        },
    },
    {
        "name": "tool_seo_search_volume",
        "description": (
            "Consulta el volumen de búsqueda mensual de keywords vía DataForSEO (Google Ads). "
            "Usá esta tool cuando el usuario pida volumen de búsqueda, search volume, tendencias "
            "de keywords o métricas de demanda de búsqueda."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lista de keywords a consultar (máximo 50).",
                },
                "location_code": {
                    "type": "integer",
                    "description": "Código de ubicación DataForSEO (omitir para usar el default del espacio, ej. 2484 para México).",
                },
                "language_code": {
                    "type": "string",
                    "description": "Código de idioma DataForSEO (omitir para usar el default del espacio, ej. 'es').",
                },
            },
            "required": ["keywords"],
        },
    },
    {
        "name": "tool_list_folder",
        "description": (
            "Lista las subcarpetas y documentos dentro de una carpeta del espacio de trabajo. "
            "Si no se pasa folder_id, lista el contenido de la raíz. "
            "Usá esta tool antes de crear, mover o editar archivos para conocer qué existe y obtener los UUIDs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "folder_id": {
                    "type": "string",
                    "description": "UUID de la carpeta a listar (omitir para listar la raíz)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "tool_read_document",
        "description": (
            "Descarga y devuelve el contenido completo de un documento (Markdown o HTML). "
            "Usá esta tool cuando necesites leer, resumir, editar o analizar el contenido de un archivo existente."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "UUID del documento a leer"},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "tool_search_documents",
        "description": (
            "Busca documentos por nombre/título (búsqueda parcial, sin distinguir mayúsculas). "
            "Usá esta tool cuando el usuario mencione un documento por nombre y necesitás su UUID "
            "para leerlo, editarlo o moverlo."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Texto a buscar en el título del documento"},
                "folder_id": {
                    "type": "string",
                    "description": "UUID de carpeta para limitar la búsqueda (opcional)",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "tool_seo_serp_organic",
        "description": (
            "Consulta el SERP orgánico de Google para una keyword vía DataForSEO. "
            "Usá esta tool cuando el usuario pida resultados de búsqueda, ranking, posiciones en "
            "Google, SERP o top 10 orgánico de una keyword específica."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "keyword": {
                    "type": "string",
                    "description": "Keyword a consultar en el SERP de Google.",
                },
                "depth": {
                    "type": "integer",
                    "description": "Número de resultados a recuperar (5-30, omitir para usar el default del espacio).",
                },
                "location_code": {
                    "type": "integer",
                    "description": "Código de ubicación DataForSEO (omitir para usar el default del espacio).",
                },
                "language_code": {
                    "type": "string",
                    "description": "Código de idioma DataForSEO (omitir para usar el default del espacio).",
                },
            },
            "required": ["keyword"],
        },
    },
    {
        "name": "tool_seo_keywords_for_url",
        "description": (
            "Obtiene las keywords asociadas a un sitio web o URL vía DataForSEO (Google Ads). "
            "Usá esta tool cuando el usuario pida las keywords de un dominio o página, quiera "
            "analizar por qué términos rankea un competidor, o necesite descubrir keywords a "
            "partir de una URL."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Dominio o URL a analizar (ej: 'competitor.com' o 'https://competitor.com/blog').",
                },
                "limit": {
                    "type": "integer",
                    "description": "Cantidad máxima de keywords a devolver (default 20, máximo 1000).",
                },
                "location_code": {
                    "type": "integer",
                    "description": "Código de ubicación DataForSEO (omitir para usar el default del espacio).",
                },
                "language_code": {
                    "type": "string",
                    "description": "Código de idioma DataForSEO (omitir para usar el default del espacio).",
                },
            },
            "required": ["url"],
        },
    },
]
