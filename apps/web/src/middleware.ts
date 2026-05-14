import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicConfigOptional } from "@/lib/supabase/env";

/**
 * Refresco de sesión Supabase (JWT en cookies) antes de Server Components.
 * Usa getClaims() para validar/refrescar según documentación actual.
 */
export async function middleware(request: NextRequest) {
  const cfg = getSupabasePublicConfigOptional();
  let response = NextResponse.next({ request });

  if (!cfg) {
    return response;
  }

  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  const pathname = request.nextUrl.pathname;
  const isProtected = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  if (isProtected && !data?.claims?.sub) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
