"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentRunStep } from "@/lib/types/agent-steps";

const DEFAULT_PLACEHOLDER: AgentRunStep[] = [
  {
    id: "starting",
    kind: "graph",
    label: "Procesando tu consulta…",
    description: "El agente está analizando tu mensaje.",
    status: "running",
    detail: null,
    step_index: 1,
    tool_name: null,
  },
];

type AgentStepsContextValue = {
  isRunning: boolean;
  activeSteps: AgentRunStep[] | null;
  getStepsForTurn: (turnIndex: number) => AgentRunStep[] | undefined;
  onRunStart: () => void;
  onRunComplete: (turnIndex: number, steps: AgentRunStep[]) => void;
  onRunEnd: () => void;
  onStepProgress: (
    node: string,
    label: string,
    description: string,
    status: "running" | "done",
  ) => void;
  onToolProgress: (
    toolName: string,
    label: string,
    description: string,
    status: "running" | "done",
    ok?: boolean,
    detail?: string | null,
  ) => void;
};

const AgentStepsContext = createContext<AgentStepsContextValue | null>(null);

export function AgentStepsProvider({ children }: { children: ReactNode }) {
  const [isRunning, setIsRunning] = useState(false);
  const [activeSteps, setActiveSteps] = useState<AgentRunStep[] | null>(null);
  const [stepsByTurn, setStepsByTurn] = useState<Record<number, AgentRunStep[]>>({});
  const hasRealEvents = useRef(false);

  const upsertStep = useCallback((incoming: AgentRunStep) => {
    setActiveSteps((prev) => {
      const list = prev ?? [];
      const idx = list.findIndex(
        (s) =>
          s.id === incoming.id ||
          (incoming.tool_name && s.tool_name === incoming.tool_name && s.kind === "tool") ||
          (incoming.kind === "graph" && s.kind === "graph" && s.label === incoming.label),
      );
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...incoming };
        return next;
      }
      if (!hasRealEvents.current) {
        hasRealEvents.current = true;
        return [{ ...incoming, step_index: 1 }];
      }
      const maxIdx = list.length > 0 ? Math.max(...list.map((s) => s.step_index)) : 0;
      return [...list, { ...incoming, step_index: incoming.step_index || maxIdx + 1 }];
    });
  }, []);

  const onRunStart = useCallback(() => {
    hasRealEvents.current = false;
    setIsRunning(true);
    setActiveSteps(DEFAULT_PLACEHOLDER);
  }, []);

  const onStepProgress = useCallback(
    (node: string, label: string, description: string, status: "running" | "done") => {
      const uiStatus = status === "running" ? ("running" as const) : ("completed" as const);
      upsertStep({
        id: `graph-${node}`,
        kind: "graph",
        label,
        description,
        status: uiStatus,
        detail: null,
        step_index: 0,
        tool_name: null,
      });
    },
    [upsertStep],
  );

  const onToolProgress = useCallback(
    (
      toolName: string,
      label: string,
      description: string,
      status: "running" | "done",
      ok?: boolean,
      detail?: string | null,
    ) => {
      const uiStatus = status === "running" ? ("running" as const) : ("completed" as const);
      upsertStep({
        id: `tool-${toolName}`,
        kind: "tool",
        label,
        description,
        status: uiStatus,
        detail: detail ?? (ok === false ? "Error en la herramienta." : null),
        step_index: 0,
        tool_name: toolName,
      });
    },
    [upsertStep],
  );

  const onRunComplete = useCallback(
    (turnIndex: number, steps: AgentRunStep[]) => {
      const normalized =
        steps.length > 0
          ? steps.map((s) => ({
              ...s,
              status: (s.status === "running" ? "completed" : s.status) as AgentRunStep["status"],
            }))
          : [];
      if (normalized.length > 0) {
        setStepsByTurn((prev) => ({ ...prev, [turnIndex]: normalized }));
      }
    },
    [],
  );

  const onRunEnd = useCallback(() => {
    setIsRunning(false);
    setActiveSteps(null);
    hasRealEvents.current = false;
  }, []);

  const getStepsForTurn = useCallback(
    (turnIndex: number) => stepsByTurn[turnIndex],
    [stepsByTurn],
  );

  const value = useMemo(
    () => ({
      isRunning,
      activeSteps,
      getStepsForTurn,
      onRunStart,
      onRunComplete,
      onRunEnd,
      onStepProgress,
      onToolProgress,
    }),
    [
      isRunning,
      activeSteps,
      getStepsForTurn,
      onRunStart,
      onRunComplete,
      onRunEnd,
      onStepProgress,
      onToolProgress,
    ],
  );

  return (
    <AgentStepsContext.Provider value={value}>{children}</AgentStepsContext.Provider>
  );
}

export function useAgentSteps() {
  const ctx = useContext(AgentStepsContext);
  if (!ctx) {
    throw new Error("useAgentSteps debe usarse dentro de AgentStepsProvider");
  }
  return ctx;
}

export function useOptionalAgentSteps(): AgentStepsContextValue | null {
  return useContext(AgentStepsContext);
}

// Re-exports de compatibilidad
export const SeoStepsProvider = AgentStepsProvider;
export const useSeoSteps = useAgentSteps;
export const useOptionalSeoSteps = useOptionalAgentSteps;
