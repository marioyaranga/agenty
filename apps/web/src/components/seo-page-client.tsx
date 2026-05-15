"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useWorkspace } from "@/lib/contexts/workspace-context";
import { useWorkyAiSeoRuntime } from "@/lib/assistant-ui/workyai-seo-runtime";
import { Thread } from "@/components/assistant-ui/thread";
import type { TenantOption } from "@/lib/types/tenant";

export function SeoPageClient({ tenants: _tenants }: { tenants: TenantOption[] }) {
  const { activeTenantId } = useWorkspace();

  if (!activeTenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Seleccioná un espacio en la barra superior para consultar volumen y SERP
        </p>
      </div>
    );
  }

  return <SeoInner tenantId={activeTenantId} />;
}

function SeoInner({ tenantId }: { tenantId: string }) {
  const { runtime } = useWorkyAiSeoRuntime(tenantId);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-3">
          <h1 className="text-sm font-medium text-foreground">SEO</h1>
          <p className="text-xs text-muted-foreground">
            Volumen de búsqueda y SERP (DataForSEO). Escribí en texto libre, por
            ejemplo: «volumen de marketing digital» o «SERP de agencia seo».
          </p>
        </header>
        <div className="min-h-0 flex-1">
          <Thread className="h-full" />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
