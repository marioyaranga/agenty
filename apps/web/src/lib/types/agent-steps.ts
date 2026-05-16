export type AgentStepKind = "graph" | "tool" | "seo";

export type AgentRunStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped";

export type WebSource = { uri: string; title: string };

export type AgentRunStep = {
  id: string;
  kind: AgentStepKind;
  label: string;
  description: string;
  status: AgentRunStepStatus;
  detail?: string | null;
  step_index: number;
  tool_name?: string | null;
  data?: { web_sources?: WebSource[] } | null;
};

/** @deprecated Usar AgentRunStep */
export type SeoSubagentStep = AgentRunStep;

/** @deprecated Usar AgentRunStepStatus */
export type SeoSubagentStepStatus = AgentRunStepStatus;
