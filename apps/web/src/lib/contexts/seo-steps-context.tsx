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
import type { SeoSubagentStep, SeoSubagentPhase } from "@/lib/types/seo-agent";

const DEFAULT_PLACEHOLDER: SeoSubagentStep[] = [
  {
    id: "parse",
    label: "Procesando tu consulta…",
    description: "El agente está analizando tu mensaje.",
    status: "running",
    detail: null,
    step_index: 1,
  },
];

type SeoStepsContextValue = {
  isRunning: boolean;
  activeSteps: SeoSubagentStep[] | null;
  getStepsForTurn: (turnIndex: number) => SeoSubagentStep[] | undefined;
  onRunStart: () => void;
  onRunComplete: (turnIndex: number, steps: SeoSubagentStep[]) => void;
  onRunEnd: () => void;
  onStepProgress: (node: string, label: string, description: string, status: "running" | "done") => void;
};

const SeoStepsContext = createContext<SeoStepsContextValue | null>(null);

export function SeoStepsProvider({ children }: { children: ReactNode }) {
  const [isRunning, setIsRunning] = useState(false);
  const [activeSteps, setActiveSteps] = useState<SeoSubagentStep[] | null>(null);
  const [stepsByTurn, setStepsByTurn] = useState<Record<number, SeoSubagentStep[]>>({});
  const hasRealEvents = useRef(false);

  const onRunStart = useCallback(() => {
    hasRealEvents.current = false;
    setIsRunning(true);
    setActiveSteps(DEFAULT_PLACEHOLDER);
  }, []);

  const onStepProgress = useCallback(
    (node: string, label: string, description: string, status: "running" | "done") => {
      const uiStatus = status === "running" ? ("running" as const) : ("completed" as const);
      const id = node as SeoSubagentPhase;

      setActiveSteps((prev) => {
        const existing = prev?.find((s) => s.id === id);
        if (existing) {
          return (prev ?? []).map((s) =>
            s.id === id ? { ...s, status: uiStatus } : s,
          );
        }

        const newStep: SeoSubagentStep = {
          id,
          label,
          description,
          status: uiStatus,
          detail: null,
          step_index:
            prev && prev.length > 0
              ? Math.max(...prev.map((s) => s.step_index)) + 1
              : 1,
        };

        // Reemplazar el placeholder inicial si todavía está ahí
        if (!hasRealEvents.current) {
          hasRealEvents.current = true;
          return [{ ...newStep, step_index: 1 }];
        }

        return [...(prev ?? []), newStep];
      });
    },
    [],
  );

  const onRunComplete = useCallback(
    (turnIndex: number, steps: SeoSubagentStep[]) => {
      setStepsByTurn((prev) => ({ ...prev, [turnIndex]: steps }));
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
    }),
    [
      isRunning,
      activeSteps,
      getStepsForTurn,
      onRunStart,
      onRunComplete,
      onRunEnd,
      onStepProgress,
    ],
  );

  return (
    <SeoStepsContext.Provider value={value}>{children}</SeoStepsContext.Provider>
  );
}

export function useSeoSteps() {
  const ctx = useContext(SeoStepsContext);
  if (!ctx) {
    throw new Error("useSeoSteps debe usarse dentro de SeoStepsProvider");
  }
  return ctx;
}

export function useOptionalSeoSteps(): SeoStepsContextValue | null {
  return useContext(SeoStepsContext);
}
