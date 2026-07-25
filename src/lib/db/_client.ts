// Shared Supabase client type for data-layer functions.
// Works with both the server client (createServerClient) and the browser
// client (createBrowserClient) because both expose the same typed query API.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type DbClient = SupabaseClient<Database>;

// Small helper for "I need the authenticated user's id here" in mutations.
export async function getCurrentUserId(supabase: DbClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

// "This table doesn't exist yet" — PostgREST PGRST205 / Postgres 42P01.
//
// A migration can land on the VM after the image that expects it (the deploy
// order is pull → migrate → rebuild, and the app can be up in between), so
// reads against a brand-new table have to degrade instead of crashing the page.
// The *Safe read wrappers use this to return null, which callers read as "not
// migrated yet, hide the feature" — distinct from [] meaning "migrated, empty".
//
// schedules.ts and gamification.ts each carry their own copy of this predicate
// from before it was shared; they're left alone deliberately (working code, own
// tests) — new modules should import this one.
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /schema cache|does not exist/i.test(e.message ?? "");
}
