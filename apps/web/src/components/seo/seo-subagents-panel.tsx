"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  MinusCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SeoSubagentStep, SeoSubagentStepStatus } from "@/lib/types/seo-agent";

function StatusIcon({ status }: { status: SeoSubagentStepStatus }) {
  if (status === "running") {
    return (
      <Loader2
        className="size-4 shrink-0 animate-spin text-primary"
        aria-hidden
      />
    );
  }
  if (status === "completed") {
    return (
      <CheckCircle2
        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }
  if (status === "skipped") {
    return (
      <MinusCircle
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    );
  }
  return (
    <Circle className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
  );
}

function SeoSubagentRow({ step }: { step: SeoSubagentStep }) {
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border border-transparent px-2 py-2",
        step.status === "running" && "border-border bg-muted/40",
      )}
    >
      <StatusIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{step.label}</p>
        <p className="text-xs text-muted-foreground">{step.description}</p>
        {step.detail ? (
          <p className="mt-1 text-xs text-foreground/80">{step.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function SeoSubagentsPanel({
  steps,
  defaultOpen = true,
  className,
}: {
  steps: SeoSubagentStep[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const running = steps.some((s) => s.status === "running");
  const completed = steps.filter((s) => s.status === "completed").length;
  const label = running
    ? "Subagentes en ejecución…"
    : `${completed} subagente(s) completado(s)`;

  if (steps.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("w-full rounded-lg border bg-muted/20", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted/30">
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1">{label}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-0.5 border-t px-1 py-2">
          {steps.map((step) => (
            <SeoSubagentRow key={step.id} step={step} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
