export type AgentCitation = {
  chunk_id: string;
  document_id: string;
  heading_path: string;
  similarity: number;
};

export type AgentChatResponse = {
  run_id: string;
  answer: string;
  citations: AgentCitation[];
  langsmith_trace_id: string | null;
  langsmith_enabled: boolean;
};
