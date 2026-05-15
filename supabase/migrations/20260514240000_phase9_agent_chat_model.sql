-- Modelo de chat del agente por tenant (opcional; NULL = predeterminado del servidor).
-- Lectura/escritura solo vía Flask con service_role (misma postura que tenant_ai_settings).

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS agent_chat_model text;

COMMENT ON COLUMN public.tenant_ai_settings.agent_chat_model IS
  'ID del modelo Gemini para reescritura y generación del agente (lista permitida en Flask). NULL usa AGENT_DEFAULT_CHAT_MODEL o gemini-2.0-flash.';
