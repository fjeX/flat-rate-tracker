// Server-side Supabase client — used in Server Components, Server Actions, and Route Handlers.
// cookies() is async in Next.js 15+, so this factory is async.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { authCookieName, serverSupabaseUrl } from "./config";
import { FIXTURE_MODE } from "@/lib/fixtures/enabled";
import { createFixtureClient } from "@/lib/fixtures/client";

export async function createClient() {
  // Fixture mode: hand back a client backed by frozen data instead of Postgres.
  // This is the single seam the whole visual-regression gate hangs on — every
  // Server Component gets its DB handle here, and the four routes that call
  // supabase.auth.getUser() directly get their fake user from it too.
  //
  // The cast is load-bearing: without it the return type widens to a union and
  // every db/*.ts function (typed SupabaseClient<Database>) stops compiling.
  // The fixture client implements the slice of that surface db/ actually calls.
  if (FIXTURE_MODE) {
    return createFixtureClient() as unknown as ReturnType<typeof createServerClient<Database>>;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: { name: authCookieName() },
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
