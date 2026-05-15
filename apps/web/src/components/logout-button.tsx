"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export async function signOutAndRedirect(
  router: Pick<ReturnType<typeof useRouter>, "push" | "refresh">,
) {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/login");
  router.refresh();
}

export function LogoutButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void signOutAndRedirect(router)}
    >
      Cerrar sesión
    </Button>
  );
}
