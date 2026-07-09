// Session-refresh helper invoked from src/proxy.ts.
// Runs on every matched request, reads/writes auth cookies, and redirects
// unauthenticated users away from protected routes.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { authCookieName, serverSupabaseUrl } from "./config";

// Auth pages redirect logged-in users to the app. Guest routes allow anyone.
const AUTH_PAGES = ["/signin", "/signup"];
const GUEST_ROUTES = ["/guest"];
// Design-direction prototypes (Phase 1 of the design overhaul) — static mock
// data, no user data, safe to serve unauthenticated. Remove after the overhaul.
const PREVIEW_ROUTES = ["/preview"];
// OAuth callback — hit before the user has a session, so it must pass through
// unauthenticated. The handler at /auth/callback exchanges the code and sets
// the auth cookies itself.
const CALLBACK_ROUTES = ["/auth/"];
// Public routes that don't require auth (landing page, etc.)
const PUBLIC_ROUTES = ["/"];

export async function updateSession(request: NextRequest) {
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
  const isPreviewRoute = PREVIEW_ROUTES.some((p) => pathname.startsWith(p));

  if (!user && !isAuthPage && !isGuestRoute && !isCallbackRoute && !isPublicRoute && !isPreviewRoute) {
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
