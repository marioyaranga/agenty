-- Fase 14: Google Search Grounding nativo de Gemini por tenant.
-- web_grounding_enabled: flag opt-in que el agente consulta para activar google_search.
-- Amplía el CHECK de agent_steps.step_key con 'web_grounding'.

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS web_grounding_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_step_key_check;

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_step_key_check CHECK (
    step_key = ANY (
      ARRAY[
        'retrieve'::text,
        'generate'::text,
        'rewrite_query'::text,
        'respond_no_context'::text,
        'tool_semantic_search'::text,
        'tool_create_folder'::text,
        'tool_create_document'::text,
        'tool_update_document_content'::text,
        'tool_rename'::text,
        'tool_move'::text,
        'tool_delete_document'::text,
        'tool_delete_folder'::text,
        'tool_seo_search_volume'::text,
        'tool_seo_serp_organic'::text,
        'web_grounding'::text
      ]
    )
  );
