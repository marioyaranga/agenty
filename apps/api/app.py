"""
API Flask: healthcheck, CORS hacia WEB_ORIGIN y endpoints versionados
(Fase 2: JWT Supabase; Fase 3: documentos + Storage con service_role; Fase 5: agente + LangSmith opcional; Fase 6: clave Gemini por tenant; Fase 7: grafo LangGraph con reintentos, auditoría `audit_events` y GET audit owner/admin; Fase 8: notificaciones in-app `in_app_notifications` desde Flask; Fase 11: seeding de carpeta y archivos por defecto en workspaces nuevos; Fase 12: agentes SEO con DataForSEO por tenant).
"""

import os

from flask import Flask, jsonify
from flask_cors import CORS

from routes.agent import bp as agent_bp
from routes.audit import bp as audit_bp
from routes.documents import bp as documents_bp
from routes.folders import bp as folders_bp
from routes.seo_agent import bp as seo_agent_bp
from routes.settings_ai import bp as settings_ai_bp
from routes.settings_seo import bp as settings_seo_bp
from routes.v1 import bp as v1_bp
from routes.workspace_bootstrap import bp as workspace_bootstrap_bp


def create_app() -> Flask:
    app = Flask(__name__)

    try:
        max_upload = int(os.environ.get("MAX_UPLOAD_BYTES", "5242880").strip())
    except ValueError:
        max_upload = 5_242_880
    # Margen para límites multipart (boundary + campos de formulario).
    app.config["MAX_CONTENT_LENGTH"] = max_upload + 256 * 1024

    web_origin = os.environ.get("WEB_ORIGIN", "").strip()
    if web_origin:
        origins = [o.strip() for o in web_origin.split(",") if o.strip()]
        CORS(
            app,
            resources={
                r"/*": {
                    "origins": origins,
                    "allow_headers": ["Authorization", "Content-Type", "X-Tenant-Id"],
                }
            },
        )
    else:
        # Sin WEB_ORIGIN no se habilita CORS (desarrollo local puede usar mismo origen o proxy).
        pass

    app.register_blueprint(v1_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(folders_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(audit_bp)
    app.register_blueprint(settings_ai_bp)
    app.register_blueprint(settings_seo_bp)
    app.register_blueprint(seo_agent_bp)
    app.register_blueprint(workspace_bootstrap_bp)

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    return app


app = create_app()
