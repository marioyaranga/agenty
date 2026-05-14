import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Cliente Supabase en servidor (Server Components, Route Handlers, Server Actions).
 * Sigue el patrón oficial de @supabase/ssr con cookies de Next.js.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll desde Server Component: el middleware/proxy refresca la sesión.
        }
      },
    },
  });
}
