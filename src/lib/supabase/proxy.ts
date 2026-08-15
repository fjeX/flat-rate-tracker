// Session-refresh helper invoked from src/proxy.ts.
// Runs on every matched request, reads/writes auth cookies, and redirects
// unauthenticated users away from protected routes.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { authCookieName, serverSupabaseUrl } from "./config";
import { FIXTURE_MODE } from "@/lib/fixtures/enabled";

// Auth pages redirect logged-in users to the app. Guest routes allow anyone.
const AUTH_PAGES = ["/signin", "/signup"];
const GUEST_ROUTES = ["/guest"];
// Password recovery. BOTH pages must pass through in BOTH directions.
//
//   /reset-password — signed-out on arrival from the email link, then signed-in
//     the instant the code exchange succeeds. An AUTH_PAGES-style bounce would
//     fire mid-flow, one step before the user sets the password they came for.
//
//   /forgot-password — this was in AUTH_PAGES and it deadlocked a real user.
//     Clicking a recovery link SIGNS YOU IN (GoTrue's /verify establishes a
//     session before redirecting). So the moment any link is clicked, the
//     bounce-to-dashboard rule made "request another one" unreachable, exactly
//     when the person needs it most. A signed-in user asking to reset their
//     password is a normal request — the mail only ever goes to their own
//     address — and it must never be answered with a redirect.
const RECOVERY_ROUTES = ["/reset-password", "/forgot-password"];
// OAuth callback — hit before the user has a session, so it must pass through
// unauthenticated. The handler at /auth/callback exchanges the code and sets
// the auth cookies itself.
const CALLBACK_ROUTES = ["/auth/"];
// Public routes that don't require auth (landing page, etc.)
const PUBLIC_ROUTES = ["/"];

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

  const pathname = request.nextUrl.pathname;
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));
  const isGuestRoute = GUEST_ROUTES.some((p) => pathname.startsWith(p));
  const isCallbackRoute = CALLBACK_ROUTES.some((p) => pathname.startsWith(p));
  const isPublicRoute = PUBLIC_ROUTES.some((p) => pathname === p);
  const isRecoveryRoute = RECOVERY_ROUTES.some((p) => pathname.startsWith(p));

  if (
    !user &&
    !isAuthPage &&
    !isGuestRoute &&
    !isCallbackRoute &&
    !isPublicRoute &&
    !isRecoveryRoute
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  if (user && (isAuthPage || isPublicRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
