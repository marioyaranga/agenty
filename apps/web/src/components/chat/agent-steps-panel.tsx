"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Cog,
  Loader2,
  MinusCircle,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AgentRunStep, AgentRunStepStatus, AgentStepKind } from "@/lib/types/agent-steps";

function StatusIcon({ status }: { status: AgentRunStepStatus }) {
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

function KindIcon({ kind }: { kind: AgentStepKind }) {
  if (kind === "tool") {
    return <Cog className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (kind === "seo") {
    return <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function AgentStepRow({ step }: { step: AgentRunStep }) {
  const detail = step.detail?.trim() ?? "";
  const longDetail = detail.length > 120 || detail.includes("\n");

  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border border-transparent px-2 py-2",
        step.status === "running" && "border-border bg-background",
      )}
    >
      <StatusIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindIcon kind={step.kind} />
          <p className="text-sm font-medium text-foreground">{step.label}</p>
          {step.kind === "tool" && step.tool_name ? (
            <Badge variant="secondary" className="font-mono text-xs">
              {step.tool_name.replace(/^tool_/, "")}
            </Badge>
          ) : null}
          {step.status === "completed" && step.kind === "tool" && step.detail?.startsWith("Error") ? (
            <Badge variant="destructive" className="text-xs">
              error
            </Badge>
          ) : null}
        </div>
        <p className="text-sm leading-normal text-muted-foreground">{step.description}</p>
        {detail ? (
          longDetail ? (
            <ScrollArea className="mt-2 max-h-24 rounded-md border bg-muted/30 p-2">
              <p className="min-w-0 break-words text-sm leading-normal text-foreground/80 [overflow-wrap:anywhere]">
                {detail}
              </p>
            </ScrollArea>
          ) : (
            <p className="mt-1 min-w-0 break-words text-sm leading-normal text-foreground/80 [overflow-wrap:anywhere]">
              {detail}
            </p>
          )
        ) : null}
      </div>
    </li>
  );
}

export function AgentStepsPanel({
  steps,
  defaultOpen = true,
  className,
}: {
  steps: AgentRunStep[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const running = steps.some((s) => s.status === "running");
  const completed = steps.filter((s) => s.status === "completed").length;
  const label = running
    ? "Pasos del agente en ejecución…"
    : `${completed} paso(s) completado(s)`;

  if (steps.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("w-full min-w-0 rounded-2xl rounded-tl-sm border bg-card shadow-sm", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/30 rounded-2xl rounded-tl-sm data-[state=open]:rounded-b-none">
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1">Pasos del agente</span>
        <span className="text-xs font-normal text-muted-foreground">{label}</span>
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
            <AgentStepRow key={step.id} step={step} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
