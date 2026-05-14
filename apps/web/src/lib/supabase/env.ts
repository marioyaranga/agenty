/**
 * Variables públicas de Supabase (URL + anon o publishable).
 * Soporta `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legado) o `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
 */
export function getSupabasePublicConfigOptional():
  | { url: string; anonKey: string }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function getSupabasePublicConfig(): { url: string; anonKey: string } {
  const cfg = getSupabasePublicConfigOptional();
  if (!cfg) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y una clave NEXT_PUBLIC_SUPABASE_ANON_KEY o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return cfg;
}
