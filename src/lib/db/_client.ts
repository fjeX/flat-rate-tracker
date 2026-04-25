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
