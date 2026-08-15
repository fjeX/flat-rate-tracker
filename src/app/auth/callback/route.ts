// OAuth callback — where GoTrue redirects the browser after a successful
// Google login, carrying a one-time `?code=`. We exchange that code for a
// session (sets the auth cookies via @supabase/ssr, PKCE flow), seed the
// starter op codes for brand-new accounts, then land the user on /dashboard.
//
// Note: this route must be reachable WITHOUT an existing session — the user
// has no auth cookie yet when they arrive. src/lib/supabase/proxy.ts allows
// `/auth/` through for exactly this reason.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { seedStarterOpCodesIfEmpty } from "@/lib/seed-opcodes";
import { reportServerError } from "@/lib/report-error-server";
import {
  forwardedHostSchema,
  oauthCodeSchema,
} from "@/lib/validation/actions";

function signinError(base: string, message: string) {
  return NextResponse.redirect(`${base}/signin?error=${encodeURIComponent(message)}`);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const oauthError = searchParams.get("error");

  // Behind Traefik the request origin can be the internal container address,
  // so prefer the forwarded host for the user-facing redirect.
  //
  // The header decides where a browser carrying fresh auth cookies lands, and
  // anything upstream can set it — so it is used only if it parses as a bare
  // hostname. A malformed one falls back to the request's own origin, which is
  // the same thing local dev already uses.
  const forwardedHostRaw = request.headers.get("x-forwarded-host");
  const forwardedHost = forwardedHostSchema.safeParse(forwardedHostRaw);
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base =
    isLocalEnv || !forwardedHost.success ? origin : `https://${forwardedHost.data}`;

  // User denied consent, or Google returned an error.
  if (oauthError) {
    return signinError(base, "Google sign-in was cancelled. Please try again.");
  }

  // A `code` that isn't shaped like one never reaches GoTrue: the exchange is
  // the one call here that turns a query parameter into a session.
  const code = oauthCodeSchema.safeParse(searchParams.get("code"));
  if (!code.success) {
    return signinError(base, "Sign-in failed. Please try again.");
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code.data);
  if (exchangeError) {
    return signinError(base, "Could not complete Google sign-in. Please try again.");
  }

  // New Google users never hit the email signUp action, so they'd otherwise
  // land with an empty library. Idempotent — a no-op for returning users.
  try {
    await seedStarterOpCodesIfEmpty(supabase);
  } catch (err) {
    // Non-fatal — the user can add codes manually — but report it instead of
    // swallowing so a broken seed path is visible.
    await reportServerError(err, { url: "route:auth/callback/seedStarterOpCodes" });
  }

  return NextResponse.redirect(`${base}/dashboard`);
}
