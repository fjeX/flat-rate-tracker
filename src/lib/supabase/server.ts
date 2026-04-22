// Server-side Supabase client — used in Server Components, Server Actions, and Route Handlers.
// cookies() is async in Next.js 15+, so this factory is async.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll was called from a Server Component render — safe to
            // ignore if there's a proxy/middleware refreshing sessions.
          }
        },
      },
    },
  );
}

export type TypedSupabaseClient = Awaited<ReturnType<typeof createClient>>;
