"""Endpoints /v1/tenants/.../documents: subida, descarga y borrado con JWT + rol por tenant.

Fase 3: metadatos en `public.documents` (RLS en cliente) y bytes en Storage bucket
`tenant_documents` vía service_role desde este API (sin exponer la clave al browser).

Fase 4: indexación RAG síncrona (Markdown) + reindex + consulta semántica (`rag/query` vía `rag.match_chunks`).
Fase 6: embeddings y RAG resuelven clave Gemini por tenant (`gemini_keys`) cuando corresponde.
Fase 8: tras indexación Markdown (alta o reindex), notificación in-app al `created_by` (ready/failed).

Persistencia de filas tras update+select: ver ``postgrest_utils.first_dict_from_execute`` (postgrest-py reciente).
"""

from __future__ import annotations

import os
import re
import uuid
from typing import Any

from flask import Blueprint, Response, jsonify, request
from storage3.exceptions import StorageApiError
from supabase import Client
from werkzeug.utils import secure_filename

from audit_log import record_audit
from notifications import notify_document_index_outcome
from postgrest_utils import first_dict_from_execute
from rag.index_document import (
    is_real_markdown,
    sync_index_markdown_document,
    truncate_index_error,
)
from rag.match_chunks import match_document_chunks
from tenant_http import (
    admin_supabase_client,
    membership_role,
    parse_uuid,
    require_bearer_jwt,
    require_matching_tenant_header,
)

bp = Blueprint("documents", __name__, url_prefix="/v1")

BUCKET_ID = "tenant_documents"

EDITOR_ROLES = frozenset({"editor", "admin", "owner"})

ALLOWED_EXTENSIONS = frozenset(
    {
        ".md",
        ".markdown",
        ".mdown",
        ".mkd",
        ".html",
        ".htm",
        ".txt",
        ".text",
    }
)


def _max_upload_bytes() -> int:
    raw = os.environ.get("MAX_UPLOAD_BYTES", "5242880").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 5_242_880


def _index_status_for_mime(mime: str) -> str:
    base = (mime or "").split(";", 1)[0].strip().lower()
    if base in ("text/markdown", "text/x-markdown"):
        return "pending"
    return "ready"


def _allowed_extension(filename: str) -> bool:
    lower = (filename or "").lower()
    return any(lower.endswith(ext) for ext in ALLOWED_EXTENSIONS)


def _sanitize_storage_filename(filename: str) -> str:
    base = secure_filename(filename) or "archivo"
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "archivo"
    return base[:180]


@bp.get("/tenants/<tenant_id>/documents")
def list_documents(tenant_id: str):
    """Lista documentos del tenant (server-side, para el agente y el explorador)."""
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

    folder_id = request.args.get("folder_id") or None
    q = (
        client.table("documents")
        .select(
            "id, folder_id, title, mime_type, size_bytes, "
            "index_status, created_by, created_at, updated_at"
        )
        .eq("tenant_id", tenant_id)
    )
    if folder_id:
        q = q.eq("folder_id", folder_id)
    else:
        is_null = request.args.get("root")
        if is_null == "true":
            q = q.is_("folder_id", "null")

    search = (request.args.get("search") or "").strip()
    if search:
        q = q.ilike("title", f"%{search}%")

    res = q.order("title").limit(50).execute()
    return jsonify({"documents": res.data or []}), 200


@bp.post("/tenants/<tenant_id>/documents/create")
def create_document_json(tenant_id: str):
    """Crea un documento vacío o con contenido vía JSON (sin multipart).

    Body: { title, folder_id?, content?, mime_type? }
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
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title or len(title) > 500:
        return jsonify({"error": "title inválido (1–500 caracteres)"}), 400

    mime_raw = (body.get("mime_type") or "text/markdown").strip()
    mime = mime_raw.split(";")[0].strip() or "text/markdown"

    content_str = body.get("content") or ""
    if isinstance(content_str, str):
        raw = content_str.encode("utf-8")
    else:
        raw = b""

    max_bytes = _max_upload_bytes()
    if len(raw) > max_bytes:
        return jsonify({"error": "Contenido demasiado grande"}), 413

    folder_id = body.get("folder_id") or None
    if folder_id:
        fid, err = parse_uuid(str(folder_id), "folder_id")
        if err:
            return err
        folder_id = fid

    document_id = str(uuid.uuid4())
    safe_name = _sanitize_storage_filename(title)
    storage_path = f"{tenant_id}/{document_id}/{safe_name}"

    storage = client.storage.from_(BUCKET_ID)
    try:
        from storage3.exceptions import StorageApiError  # noqa: PLC0415
        storage.upload(
            storage_path,
            raw,
            file_options={"content-type": mime, "upsert": "false"},
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al subir a Storage", "detail": str(exc)}), 502

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
    except Exception as exc:  # noqa: BLE001
        try:
            storage.remove([storage_path])
        except Exception:  # noqa: BLE001
            pass
        return jsonify({"error": "Fallo al guardar metadatos", "detail": str(exc)}), 502

    final_row: dict[str, Any] = (ins.data or [row])[0]

    ran_markdown_index = False
    if str(final_row.get("index_status", "")) == "pending":
        ran_markdown_index = True
        status, idx_err = sync_index_markdown_document(
            client,
            tenant_id=tenant_id,
            document_id=str(final_row["id"]),
            storage_path=str(final_row["storage_path"]),
            mime_type=mime,
        )
        err_s = truncate_index_error(idx_err)
        try:
            up = (
                client.table("documents")
                .update({"index_status": status, "index_error": err_s})
                .eq("id", str(final_row["id"]))
                .eq("tenant_id", tenant_id)
                .select(
                    "id, tenant_id, folder_id, created_by, title, storage_path, mime_type, "
                    "size_bytes, index_status, index_error, created_at, updated_at"
                )
                .execute()
            )
            updated = first_dict_from_execute(up)
            if updated:
                final_row = updated
        except Exception:  # noqa: BLE001
            final_row["index_status"] = status
            final_row["index_error"] = err_s

    if ran_markdown_index:
        notify_document_index_outcome(
            client,
            tenant_id=tenant_id,
            created_by=str(final_row.get("created_by") or "") or None,
            document_id=str(final_row.get("id", document_id)),
            title=str(final_row.get("title") or title),
            index_status=str(final_row.get("index_status", "")),
            index_error=str(final_row.get("index_error") or "") or None,
        )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="document.created",
        payload={
            "document_id": str(final_row.get("id", document_id)),
            "title": title[:200],
            "mime_type": mime,
            "index_status": str(final_row.get("index_status", "")),
        },
    )

    return jsonify(final_row), 201


@bp.patch("/tenants/<tenant_id>/documents/<document_id>")
def update_document(tenant_id: str, document_id: str):
    """Actualiza metadatos y/o contenido de un documento.

    Body: { title?, folder_id?, content? }
    Si viene `content`, reemplaza el blob en Storage y re-indexa si es Markdown.
    """
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    did, err = parse_uuid(document_id, "document_id")
    if err:
        return err
    document_id = did

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    res = (
        client.table("documents")
        .select(
            "id, tenant_id, folder_id, created_by, title, storage_path, "
            "mime_type, size_bytes, index_status, index_error, created_at, updated_at"
        )
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return jsonify({"error": "Documento no encontrado"}), 404

    doc = rows[0]
    body = request.get_json(silent=True) or {}
    meta_updates: dict[str, Any] = {}
    content_changed = False

    if "title" in body:
        new_title = (body["title"] or "").strip()
        if not new_title or len(new_title) > 500:
            return jsonify({"error": "title inválido (1–500 caracteres)"}), 400
        meta_updates["title"] = new_title

    if "folder_id" in body:
        new_folder = body["folder_id"] or None
        if new_folder:
            fid, err = parse_uuid(str(new_folder), "folder_id")
            if err:
                return err
            new_folder = fid
        meta_updates["folder_id"] = new_folder

    if "content" in body:
        content_str = body["content"] or ""
        if not isinstance(content_str, str):
            return jsonify({"error": "content debe ser string"}), 400
        raw = content_str.encode("utf-8")
        max_bytes = _max_upload_bytes()
        if len(raw) > max_bytes:
            return jsonify({"error": "Contenido demasiado grande"}), 413

        mime = str(doc.get("mime_type") or "text/markdown")
        storage_path = str(doc["storage_path"])
        storage = client.storage.from_(BUCKET_ID)
        try:
            storage.upload(
                storage_path,
                raw,
                file_options={"content-type": mime, "upsert": "true"},
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": "Fallo al actualizar Storage", "detail": str(exc)}), 502

        meta_updates["size_bytes"] = len(raw)
        if is_real_markdown(mime):
            meta_updates["index_status"] = "pending"
            meta_updates["index_error"] = None
        content_changed = True

    if not meta_updates and not content_changed:
        return jsonify({"error": "Sin campos a actualizar (title, folder_id, content)"}), 400

    try:
        up = (
            client.table("documents")
            .update(meta_updates)
            .eq("id", document_id)
            .eq("tenant_id", tenant_id)
            .select(
                "id, tenant_id, folder_id, created_by, title, storage_path, "
                "mime_type, size_bytes, index_status, index_error, created_at, updated_at"
            )
            .execute()
        )
        final_row = first_dict_from_execute(up) or doc
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al actualizar metadatos", "detail": str(exc)}), 502

    ran_markdown_index = False
    if content_changed and is_real_markdown(str(doc.get("mime_type") or "")):
        ran_markdown_index = True
        status, idx_err = sync_index_markdown_document(
            client,
            tenant_id=tenant_id,
            document_id=document_id,
            storage_path=str(doc["storage_path"]),
            mime_type=str(doc.get("mime_type") or ""),
        )
        err_s = truncate_index_error(idx_err)
        try:
            up2 = (
                client.table("documents")
                .update({"index_status": status, "index_error": err_s})
                .eq("id", document_id)
                .eq("tenant_id", tenant_id)
                .select(
                    "id, tenant_id, folder_id, created_by, title, storage_path, "
                    "mime_type, size_bytes, index_status, index_error, created_at, updated_at"
                )
                .execute()
            )
            updated2 = first_dict_from_execute(up2)
            if updated2:
                final_row = updated2
        except Exception:  # noqa: BLE001
            final_row["index_status"] = status
            final_row["index_error"] = err_s

    if ran_markdown_index:
        notify_document_index_outcome(
            client,
            tenant_id=tenant_id,
            created_by=str(final_row.get("created_by") or "") or None,
            document_id=document_id,
            title=str(final_row.get("title") or ""),
            index_status=str(final_row.get("index_status", "")),
            index_error=str(final_row.get("index_error") or "") or None,
        )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="document.updated",
        payload={
            "document_id": document_id,
            "fields": list(meta_updates.keys()),
            "content_changed": content_changed,
        },
    )

    return jsonify(final_row), 200


@bp.post("/tenants/<tenant_id>/documents")
def upload_document(tenant_id: str):
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

    title = (request.form.get("title") or "").strip()
    if not title or len(title) > 500:
        return jsonify({"error": "title inválido (1–500 caracteres)"}), 400

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Falta archivo en el campo file"}), 400

    if not _allowed_extension(file.filename):
        return jsonify({"error": "Extensión no permitida"}), 400

    max_bytes = _max_upload_bytes()
    raw = file.stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        return jsonify({"error": "Archivo demasiado grande"}), 413

    mime = (file.mimetype or "application/octet-stream").split(";")[0].strip()
    if not mime:
        mime = "application/octet-stream"

    document_id = str(uuid.uuid4())
    safe_name = _sanitize_storage_filename(file.filename)
    storage_path = f"{tenant_id}/{document_id}/{safe_name}"

    storage = client.storage.from_(BUCKET_ID)
    try:
        storage.upload(
            storage_path,
            raw,
            file_options={"content-type": mime, "upsert": "false"},
        )
    except StorageApiError as exc:
        return jsonify({"error": "Fallo al subir a Storage", "detail": str(exc)}), 502

    row = {
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

    try:
        ins = client.table("documents").insert(row).execute()
    except Exception as exc:  # noqa: BLE001 — cliente PostgREST genérico
        try:
            storage.remove([storage_path])
        except StorageApiError:
            pass
        return jsonify({"error": "Fallo al guardar metadatos", "detail": str(exc)}), 502

    final_row: dict[str, Any] = (ins.data or [row])[0]

    ran_markdown_index = False
    if str(final_row.get("index_status", "")) == "pending":
        ran_markdown_index = True
        status, err = sync_index_markdown_document(
            client,
            tenant_id=tenant_id,
            document_id=str(final_row["id"]),
            storage_path=str(final_row["storage_path"]),
            mime_type=str(final_row.get("mime_type") or mime),
        )
        err_s = truncate_index_error(err)
        try:
            up = (
                client.table("documents")
                .update({"index_status": status, "index_error": err_s})
                .eq("id", str(final_row["id"]))
                .eq("tenant_id", tenant_id)
                .select(
                    "id, tenant_id, created_by, title, storage_path, mime_type, "
                    "size_bytes, index_status, index_error, created_at, updated_at"
                )
                .execute()
            )
            row = first_dict_from_execute(up)
            if row:
                final_row = row
        except Exception:  # noqa: BLE001
            final_row["index_status"] = status
            final_row["index_error"] = err_s

    if ran_markdown_index:
        notify_document_index_outcome(
            client,
            tenant_id=tenant_id,
            created_by=str(final_row.get("created_by") or "") or None,
            document_id=str(final_row.get("id", document_id)),
            title=str(final_row.get("title") or title),
            index_status=str(final_row.get("index_status", "")),
            index_error=str(final_row.get("index_error") or "") or None,
        )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="document.uploaded",
        payload={
            "document_id": str(final_row.get("id", document_id)),
            "title": title[:200],
            "mime_type": mime,
            "index_status": str(final_row.get("index_status", "")),
        },
    )

    return jsonify(final_row), 201


@bp.get("/tenants/<tenant_id>/documents/<document_id>/download")
def download_document(tenant_id: str, document_id: str):
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    did, err = parse_uuid(document_id, "document_id")
    if err:
        return err
    document_id = did

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role:
        return jsonify({"error": "Sin acceso a este espacio"}), 403

    res = (
        client.table("documents")
        .select("id, tenant_id, title, storage_path, mime_type")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return jsonify({"error": "Documento no encontrado"}), 404

    doc = rows[0]
    path = str(doc["storage_path"])
    mime = str(doc.get("mime_type") or "application/octet-stream")

    try:
        data = client.storage.from_(BUCKET_ID).download(path)
    except StorageApiError as exc:
        return jsonify({"error": "Fallo al leer Storage", "detail": str(exc)}), 502

    if not isinstance(data, (bytes, bytearray)):
        return jsonify({"error": "Respuesta de Storage inesperada"}), 502

    filename = secure_filename(str(doc.get("title") or "documento")) or "documento"
    cd = f'attachment; filename="{filename}"'
    return Response(
        bytes(data),
        mimetype=mime,
        headers={"Content-Disposition": cd},
    )


@bp.delete("/tenants/<tenant_id>/documents/<document_id>")
def delete_document(tenant_id: str, document_id: str):
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    did, err = parse_uuid(document_id, "document_id")
    if err:
        return err
    document_id = did

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    res = (
        client.table("documents")
        .select("id, storage_path")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return jsonify({"error": "Documento no encontrado"}), 404

    path = str(rows[0]["storage_path"])
    storage = client.storage.from_(BUCKET_ID)
    try:
        storage.remove([path])
    except StorageApiError:
        # Si ya no existe el objeto, seguimos con borrado de fila.
        pass

    try:
        client.table("documents").delete().eq("id", document_id).eq(
            "tenant_id", tenant_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al borrar metadatos", "detail": str(exc)}), 502

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="document.deleted",
        payload={"document_id": document_id},
    )

    return ("", 204)


@bp.post("/tenants/<tenant_id>/documents/<document_id>/reindex")
def reindex_document(tenant_id: str, document_id: str):
    claims, err = require_bearer_jwt()
    if err:
        return err
    user_id = str(claims.get("sub", ""))

    tid, err = parse_uuid(tenant_id, "tenant_id")
    if err:
        return err
    tenant_id = tid

    did, err = parse_uuid(document_id, "document_id")
    if err:
        return err
    document_id = did

    _, err = require_matching_tenant_header(tenant_id)
    if err:
        return err

    client = admin_supabase_client()
    role = membership_role(client, tenant_id, user_id)
    if not role or role not in EDITOR_ROLES:
        return jsonify({"error": "Se requiere rol editor, admin u owner"}), 403

    res = (
        client.table("documents")
        .select("id, tenant_id, created_by, title, storage_path, mime_type")
        .eq("id", document_id)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []
    if not rows:
        return jsonify({"error": "Documento no encontrado"}), 404

    doc = rows[0]
    mime = str(doc.get("mime_type") or "")
    if not is_real_markdown(mime):
        return jsonify(
            {"error": "Solo se puede reindexar Markdown (text/markdown o text/x-markdown)."}
        ), 400

    status, idx_err = sync_index_markdown_document(
        client,
        tenant_id=tenant_id,
        document_id=document_id,
        storage_path=str(doc["storage_path"]),
        mime_type=mime,
    )
    err_s = truncate_index_error(idx_err)
    try:
        up = (
            client.table("documents")
            .update({"index_status": status, "index_error": err_s})
            .eq("id", document_id)
            .eq("tenant_id", tenant_id)
            .select(
                "id, tenant_id, created_by, title, storage_path, mime_type, "
                "size_bytes, index_status, index_error, created_at, updated_at"
            )
            .execute()
        )
        payload = first_dict_from_execute(up)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": "Fallo al persistir estado de indexación", "detail": str(exc)}), 502

    if not payload:
        return jsonify({"error": "No se pudo leer el documento actualizado"}), 502

    notify_document_index_outcome(
        client,
        tenant_id=tenant_id,
        created_by=str(payload.get("created_by") or "") or None,
        document_id=document_id,
        title=str(payload.get("title") or ""),
        index_status=str(payload.get("index_status", "")),
        index_error=str(payload.get("index_error") or "") or None,
    )

    record_audit(
        client,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        event_type="document.reindexed",
        payload={"document_id": document_id},
    )

    return jsonify(payload), 200


@bp.post("/tenants/<tenant_id>/rag/query")
def rag_query(tenant_id: str):
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
    query = (body.get("query") or "").strip()
    if not query:
        return jsonify({"error": "query es obligatorio"}), 400

    try:
        match_count = int(body.get("match_count", 8))
    except (TypeError, ValueError):
        return jsonify({"error": "match_count inválido"}), 400

    try:
        min_similarity = float(body.get("min_similarity", 0.25))
    except (TypeError, ValueError):
        return jsonify({"error": "min_similarity inválido"}), 400

    match_count = max(1, min(match_count, 200))
    min_similarity = max(0.0, min(min_similarity, 1.0))

    try:
        matches = match_document_chunks(
            client,
            tenant_id=tenant_id,
            query=query,
            match_count=match_count,
            min_similarity=min_similarity,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify(
            {
                "error": "Fallo al consultar coincidencias o al generar embedding",
                "detail": str(exc),
            }
        ), 502

    return jsonify({"matches": matches}), 200
