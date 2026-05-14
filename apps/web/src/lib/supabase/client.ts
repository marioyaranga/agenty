import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Cliente Supabase en el navegador (Client Components).
 * Singleton interno de createBrowserClient.
 */
export function createClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient(url, anonKey);
}
