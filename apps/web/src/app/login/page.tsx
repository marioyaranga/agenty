import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Acceso
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Correo y contraseña (Supabase Auth).
        </p>
        <div className="mt-6">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
