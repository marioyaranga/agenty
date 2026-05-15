"""Agente conversacional (LangGraph: recuperación, reescritura opcional, generación o sin contexto).

El modelo Gemini de reescritura/generación lo elige cada tenant vía `tenant_ai_settings.agent_chat_model`
(expuesto en `GET`/`PATCH` `/v1/tenants/<id>/settings/ai`; lista permitida en `agent_chat_models.py`).
"""
