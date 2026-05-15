"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Tab } from "@/lib/contexts/viewer-context";

type Props = {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
};

export function ViewerTabsBar({ tabs, activeTabId, onActivate, onClose }: Props) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex min-h-0 shrink-0 items-end overflow-x-auto border-b bg-background scrollbar-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onActivate(tab.id)}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 border-r px-3 py-1.5 text-xs transition-colors",
              "max-w-[160px]",
              isActive
                ? "bg-background text-foreground border-b border-b-background -mb-px"
                : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="truncate max-w-[100px]">{tab.title}</span>
            {tab.dirty && (
              <span className="shrink-0 text-muted-foreground">•</span>
            )}
            <span
              role="button"
              tabIndex={0}
              aria-label={`Cerrar ${tab.title}`}
              className={cn(
                "shrink-0 rounded-sm p-0.5 transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
                "opacity-0 group-hover:opacity-100",
                isActive && "opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (tab.dirty) {
                  if (!window.confirm(`¿Cerrar "${tab.title}" con cambios sin guardar?`)) return;
                }
                onClose(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  if (tab.dirty) {
                    if (!window.confirm(`¿Cerrar "${tab.title}" con cambios sin guardar?`)) return;
                  }
                  onClose(tab.id);
                }
              }}
            >
              <X size={10} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
