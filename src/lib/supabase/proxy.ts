// Session-refresh helper invoked from src/proxy.ts.
// Runs on every matched request, reads/writes auth cookies, and redirects
// unauthenticated users away from protected routes.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { authCookieName, serverSupabaseUrl } from "./config";
import { FIXTURE_MODE } from "@/lib/fixtures/enabled";

// Which route is reachable in which auth state now lives in ./proxy-routes as a
// pure function, so it can be unit tested. It could not be, inline here, and a
// signed-in user got deadlocked out of /forgot-password as a result — see that
// module's header. This file keeps the cookie and session plumbing; the routing
// decision belongs to decideAuthRedirect().
import { decideAuthRedirect } from "./proxy-routes";

export async function updateSession(request: NextRequest) {
  /**
   * Fixture mode: let every request through, redirecting nothing.
   *
   * This is the third place the app decides who you are, and the only one that
   * runs before page code — it builds its own createServerClient right below
   * rather than going through lib/supabase/server.ts, so stubbing that factory
   * doesn't reach here. Without this branch every authed route 307s to /signin
   * and the visual suite photographs the sign-in page thirteen times.
   *
   * Pass-through rather than "pretend a user is signed in", because of the
   * redirect at the bottom of this function: a logged-in user hitting a public
   * route gets bounced to /dashboard, which would make the landing, signin and
   * signup snapshots impossible to capture. The suite needs public AND authed
   * routes renderable in the same run, and no redirects at all is the only
   * state where that's true.
   */
  if (FIXTURE_MODE) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: { name: authCookieName() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: calling getUser() is what actually refreshes the session.
  // Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = decideAuthRedirect(request.nextUrl.pathname, Boolean(user));
  if (redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    return NextResponse.redirect(url);
  }

  return response;
}
