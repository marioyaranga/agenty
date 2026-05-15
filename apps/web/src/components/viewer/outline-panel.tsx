"use client";

import { useMemo, useState } from "react";
import { List } from "lucide-react";
import { extractHeadings } from "@/lib/markdown/headings";
import { cn } from "@/lib/utils";

export function OutlinePanel({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length === 0) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-l bg-background transition-all",
        open ? "w-48" : "w-8",
      )}
    >
      {/* Toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Ocultar esquema" : "Ver esquema"}
        className="flex h-8 w-full items-center justify-center border-b text-muted-foreground hover:text-foreground"
      >
        <List size={13} />
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto py-2">
          {headings.map((h) => (
            <button
              key={`${h.slug}-${h.depth}`}
              type="button"
              onClick={() => {
                const el = document.getElementById(h.slug);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              title={h.text}
              className={cn(
                "block w-full truncate px-2 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground",
                h.depth === 1 && "font-semibold text-foreground/80",
                h.depth === 2 && "pl-3",
                h.depth === 3 && "pl-5",
                h.depth >= 4 && "pl-7 text-[11px]",
              )}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
