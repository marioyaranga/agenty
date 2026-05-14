import { HealthRefreshButton } from "@/components/health-refresh-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

type HealthResult =
  | { state: "no_url" }
  | { state: "ok" }
  | { state: "bad_status"; status: number }
  | { state: "error"; message: string };

async function checkApiHealth(): Promise<HealthResult> {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!raw) return { state: "no_url" };

  const base = raw.replace(/\/+$/, "");
  const url = `${base}/health`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { state: "bad_status", status: res.status };
    const data: unknown = await res.json().catch(() => null);
    if (
      data &&
      typeof data === "object" &&
      "status" in data &&
      (data as { status?: string }).status === "ok"
    ) {
      return { state: "ok" };
    }
    return { state: "bad_status", status: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return { state: "error", message };
  }
}

function healthLabel(result: HealthResult): string {
  switch (result.state) {
    case "no_url":
      return "Definí NEXT_PUBLIC_API_URL (p. ej. URL de Render) para probar el healthcheck.";
    case "ok":
      return "El API respondió {\"status\":\"ok\"}.";
    case "bad_status":
      return `El API respondió con HTTP ${result.status}.`;
    case "error":
      return `No se pudo alcanzar el API: ${result.message}`;
    default:
      return "Estado desconocido.";
  }
}

export default async function Home() {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const hasSupabaseAnon = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
  const hasApiUrl = Boolean(process.env.NEXT_PUBLIC_API_URL?.trim());

  const health = await checkApiHealth();

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">workyAI · Fase 1</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Esqueleto cloud
          </h1>
          <p className="text-muted-foreground">
            Front en Vercel y API en Render, alineado al contrato del sistema. Esta
            página solo comprueba variables públicas y el endpoint{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-sm">
              /health
            </code>
            .
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              href="/login"
            >
              Iniciar sesión
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              href="/dashboard"
            >
              Panel (requiere sesión)
            </Link>
            <Button type="button" variant="secondary" size="sm" disabled>
              Modo oscuro (tema por variables CSS)
            </Button>
            <HealthRefreshButton />
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-lg font-medium">Variables públicas (sin secretos)</h2>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">
                NEXT_PUBLIC_SUPABASE_URL
              </span>
              : {hasSupabaseUrl ? "definida" : "no definida"}
            </li>
            <li>
              <span className="font-medium text-foreground">
                NEXT_PUBLIC_SUPABASE_ANON_KEY
              </span>
              : {hasSupabaseAnon ? "definida" : "no definida"}
            </li>
            <li>
              <span className="font-medium text-foreground">
                NEXT_PUBLIC_API_URL
              </span>
              : {hasApiUrl ? "definida" : "no definida"}
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-lg font-medium">Estado del API</h2>
          <p className="text-sm text-muted-foreground">{healthLabel(health)}</p>
        </section>
      </main>
    </div>
  );
}
