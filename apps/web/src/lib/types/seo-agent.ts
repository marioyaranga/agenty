export type SeoSubagentPhase = "parse" | "volume" | "serp" | "format";

export type SeoSubagentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped";

export type SeoSubagentStep = {
  id: SeoSubagentPhase;
  label: string;
  description: string;
  status: SeoSubagentStepStatus;
  detail?: string | null;
  step_index: number;
};

export type SeoChatResponse = {
  run_id: string;
  thread_id: string;
  answer: string;
  citations: unknown[];
  steps: SeoSubagentStep[];
  langsmith_trace_id: string | null;
  langsmith_enabled: boolean;
};
