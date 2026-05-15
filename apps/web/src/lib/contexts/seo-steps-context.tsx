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
import type { SeoSubagentStep } from "@/lib/types/seo-agent";

const DEFAULT_PLACEHOLDER: SeoSubagentStep[] = [
  {
    id: "parse",
    label: "Orquestador",
    description: "Interpreta el mensaje y extrae modo y keywords.",
    status: "running",
    detail: null,
    step_index: 1,
  },
  {
    id: "volume",
    label: "Volumen de búsqueda",
    description: "Consulta DataForSEO (search volume).",
    status: "pending",
    detail: null,
    step_index: 2,
  },
  {
    id: "serp",
    label: "SERP orgánico",
    description: "Consulta resultados orgánicos en Google.",
    status: "pending",
    detail: null,
    step_index: 3,
  },
  {
    id: "format",
    label: "Respuesta",
    description: "Arma tablas y resumen en Markdown.",
    status: "pending",
    detail: null,
    step_index: 4,
  },
];

type SeoStepsContextValue = {
  isRunning: boolean;
  activeSteps: SeoSubagentStep[] | null;
  getStepsForTurn: (turnIndex: number) => SeoSubagentStep[] | undefined;
  onRunStart: () => void;
  onRunComplete: (turnIndex: number, steps: SeoSubagentStep[]) => void;
  onRunEnd: () => void;
};

const SeoStepsContext = createContext<SeoStepsContextValue | null>(null);

function advancePlaceholder(steps: SeoSubagentStep[], activeIndex: number): SeoSubagentStep[] {
  return steps.map((s, i) => {
    if (i < activeIndex) return { ...s, status: "completed" as const };
    if (i === activeIndex) return { ...s, status: "running" as const };
    return { ...s, status: "pending" as const };
  });
}

export function SeoStepsProvider({ children }: { children: ReactNode }) {
  const [isRunning, setIsRunning] = useState(false);
  const [activeSteps, setActiveSteps] = useState<SeoSubagentStep[] | null>(null);
  const [stepsByTurn, setStepsByTurn] = useState<Record<number, SeoSubagentStep[]>>({});
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePhaseIndex = useRef(0);

  const clearProgressTimer = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const onRunStart = useCallback(() => {
    clearProgressTimer();
    activePhaseIndex.current = 0;
    setIsRunning(true);
    setActiveSteps(DEFAULT_PLACEHOLDER);
    progressTimer.current = setInterval(() => {
      activePhaseIndex.current = Math.min(
        activePhaseIndex.current + 1,
        DEFAULT_PLACEHOLDER.length - 1,
      );
      setActiveSteps(
        advancePlaceholder(DEFAULT_PLACEHOLDER, activePhaseIndex.current),
      );
    }, 1600);
  }, [clearProgressTimer]);

  const onRunComplete = useCallback(
    (turnIndex: number, steps: SeoSubagentStep[]) => {
      setStepsByTurn((prev) => ({ ...prev, [turnIndex]: steps }));
    },
    [],
  );

  const onRunEnd = useCallback(() => {
    clearProgressTimer();
    setIsRunning(false);
    setActiveSteps(null);
  }, [clearProgressTimer]);

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
    }),
    [
      isRunning,
      activeSteps,
      getStepsForTurn,
      onRunStart,
      onRunComplete,
      onRunEnd,
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
