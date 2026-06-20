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

function signinError(base: string, message: string) {
  return NextResponse.redirect(`${base}/signin?error=${encodeURIComponent(message)}`);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");

  // Behind Traefik the request origin can be the internal container address,
  // so prefer the forwarded host for the user-facing redirect.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base = isLocalEnv || !forwardedHost ? origin : `https://${forwardedHost}`;

  // User denied consent, or Google returned an error.
  if (oauthError) {
    return signinError(base, "Google sign-in was cancelled. Please try again.");
  }

  if (!code) {
    return signinError(base, "Sign-in failed. Please try again.");
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return signinError(base, "Could not complete Google sign-in. Please try again.");
  }

  // New Google users never hit the email signUp action, so they'd otherwise
  // land with an empty library. Idempotent — a no-op for returning users.
  try {
    await seedStarterOpCodesIfEmpty(supabase);
  } catch { /* non-fatal — the user can add codes manually */ }

  return NextResponse.redirect(`${base}/dashboard`);
}
