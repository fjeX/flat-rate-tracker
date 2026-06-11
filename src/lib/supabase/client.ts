// Browser-side Supabase client — used in Client Components.
// Do NOT import this from Server Components; use ./server instead.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { authCookieName } from "./config";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookieOptions: { name: authCookieName() } },
  );
}
