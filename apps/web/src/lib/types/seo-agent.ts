/** @deprecated Usar `@/lib/types/agent-steps`. */
export type {
  AgentRunStep as SeoSubagentStep,
  AgentRunStepStatus as SeoSubagentStepStatus,
  AgentStepKind,
} from "@/lib/types/agent-steps";

export type SeoSubagentPhase = string;

export type SeoChatResponse = {
  run_id: string;
  thread_id: string;
  answer: string;
  citations: unknown[];
  steps: import("@/lib/types/agent-steps").AgentRunStep[];
  langsmith_trace_id: string | null;
  langsmith_enabled: boolean;
};
