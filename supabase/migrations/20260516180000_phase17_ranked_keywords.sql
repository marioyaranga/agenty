-- Fase 15: ranked keywords (Labs) en caché SEO y step_key del agente.

ALTER TABLE public.seo_cache DROP CONSTRAINT IF EXISTS seo_cache_endpoint_type_check;

ALTER TABLE public.seo_cache
  ADD CONSTRAINT seo_cache_endpoint_type_check CHECK (
    endpoint_type = ANY (
      ARRAY[
        'volume'::text,
        'serp'::text,
        'keywords_for_url'::text,
        'ranked_keywords'::text
      ]
    )
  );

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
        'tool_seo_keywords_for_url'::text,
        'tool_seo_ranked_keywords_for_url'::text
      ]
    )
  );
