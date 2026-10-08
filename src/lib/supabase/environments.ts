// Which Supabase a URL belongs to — the one place that knows staging's address.
//
// WHY THIS EXISTS
// Local dev used to point at the PROD database, so every test write on localhost
// landed in real techs' pay data. Dev now runs against a separate staging
// project, and next.config.ts refuses to start `next dev` against anything else.
//
// ALLOWLIST, NOT BLOCKLIST
// Dev may use staging or a local Supabase stack, and nothing else. A blocklist
// of "the prod URL" would go silently stale the day prod moves off
// api.slimelab.cc to Supabase Cloud; an allowlist keeps refusing any address it
// doesn't recognize, including that future one.

/** FRT-Staging (Supabase Cloud free project, us-west-1). Created 2026-10-07. */
export const STAGING_REF = "dazwengljgvpbmeovuiy";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

export type SupabaseEnv = "staging" | "local" | "other";

export function classifySupabaseUrl(url: string | undefined): SupabaseEnv {
  if (!url) return "other";
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "other";
  }
  if (host === `${STAGING_REF}.supabase.co`) return "staging";
  if (host === "127.0.0.1" || host === "localhost") return "local";
  return "other";
}
