"use client";

import { useEffect } from "react";
import { useThreadRuntime } from "@assistant-ui/react";
import { useViewer } from "@/lib/contexts/viewer-context";

export function ViewerBridge() {
  const runtime = useThreadRuntime();
  const { setContent } = useViewer();

  useEffect(() => {
    function update() {
      const state = runtime.getState();
      const last = [...state.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (!last) return;
      const text = last.content
        .filter(
          (p): p is { type: "text"; text: string } => p.type === "text",
        )
        .map((p) => p.text)
        .join("\n");
      if (text) setContent(text);
    }
    update();
    return runtime.subscribe(update);
  }, [runtime, setContent]);

  return null;
}
