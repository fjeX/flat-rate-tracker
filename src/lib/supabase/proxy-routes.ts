/**
 * Which routes are reachable in which auth state, as a pure function.
 *
 * WHY THIS IS ITS OWN MODULE
 * This logic used to live inline in proxy.ts, where it is unreachable by a
 * test: updateSession() needs a NextRequest and a live Supabase client, so the
 * only way to exercise the route rules was to deploy and click. On 2026-08-14
 * that cost a real user a deadlock — /forgot-password sat in AUTH_PAGES, which
 * bounces signed-in users to /dashboard, and clicking ANY recovery link signs
 * you in (GoTrue's /verify establishes a session before it redirects). So the
 * first click made "request another link" unreachable, at exactly the moment it
 * was needed. Nothing caught it: tsc, eslint, 791 unit tests and the smoke
 * suite all passed.
 *
 * Pulled out here, the whole thing is a string and a boolean in, a string or
 * null out — and every route can be asserted in both auth states in
 * milliseconds. proxy.ts keeps the cookie and session plumbing; this owns the
 * decision.
 */

/** Signed-out only. A signed-in visitor is sent to the app. */
const AUTH_PAGES = ["/signin", "/signup"];

/** Anyone, either state. Guest mode is deliberately usable while signed in. */
const GUEST_ROUTES = ["/guest"];

/**
 * OAuth + confirmation landing. Must pass through unauthenticated — the user
 * has no cookie yet when they arrive; the handler sets it.
 */
const CALLBACK_ROUTES = ["/auth/"];

/** Exact match, not prefix: "/" must not swallow every route beneath it. */
const PUBLIC_ROUTES = ["/"];

/**
 * Password recovery. BOTH pages must pass through in BOTH states.
 *
 *   /reset-password  — signed-out on arrival from the email link, then
 *     signed-in the instant the code exchange succeeds. An AUTH_PAGES-style
 *     bounce would fire mid-flow, one step before the user sets the password
 *     they came for.
 *
 *   /forgot-password — see the module header. A signed-in user asking to reset
 *     their password is a normal request; the mail only ever goes to their own
 *     address, so there is nothing to guard against.
 */
const RECOVERY_ROUTES = ["/reset-password", "/forgot-password"];

export const ROUTE_GROUPS = {
  AUTH_PAGES,
  GUEST_ROUTES,
  CALLBACK_ROUTES,
  PUBLIC_ROUTES,
  RECOVERY_ROUTES,
} as const;

/**
 * Where the proxy should send this request, or null to let it through.
 *
 * @param pathname request path, e.g. "/dashboard"
 * @param hasUser  whether the request carries a valid session
 */
export function decideAuthRedirect(
  pathname: string,
  hasUser: boolean,
): "/signin" | "/dashboard" | null {
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));
  const isGuestRoute = GUEST_ROUTES.some((p) => pathname.startsWith(p));
  const isCallbackRoute = CALLBACK_ROUTES.some((p) => pathname.startsWith(p));
  const isPublicRoute = PUBLIC_ROUTES.some((p) => pathname === p);
  const isRecoveryRoute = RECOVERY_ROUTES.some((p) => pathname.startsWith(p));

  if (
    !hasUser &&
    !isAuthPage &&
    !isGuestRoute &&
    !isCallbackRoute &&
    !isPublicRoute &&
    !isRecoveryRoute
  ) {
    return "/signin";
  }

  if (hasUser && (isAuthPage || isPublicRoute)) {
    return "/dashboard";
  }

  return null;
}
