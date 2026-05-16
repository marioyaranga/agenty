export type AgentStepKind = "graph" | "tool" | "seo";

export type AgentRunStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped";

export type AgentRunStep = {
  id: string;
  kind: AgentStepKind;
  label: string;
  description: string;
  status: AgentRunStepStatus;
  detail?: string | null;
  step_index: number;
  tool_name?: string | null;
};

/** @deprecated Usar AgentRunStep */
export type SeoSubagentStep = AgentRunStep;

/** @deprecated Usar AgentRunStepStatus */
export type SeoSubagentStepStatus = AgentRunStepStatus;
