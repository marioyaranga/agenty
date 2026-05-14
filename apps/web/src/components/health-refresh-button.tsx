"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/** Botón cliente para volver a ejecutar el fetch del layout/página vía `router.refresh()`. */
export function HealthRefreshButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => router.refresh()}
    >
      Actualizar comprobación del API
    </Button>
  );
}
