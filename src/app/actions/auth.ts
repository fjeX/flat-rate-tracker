"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createIsolatedClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { serverSupabaseUrl } from "@/lib/supabase/config";
import { seedStarterOpCodesIfEmpty } from "@/lib/seed-opcodes";
import { reportServerError } from "@/lib/report-error-server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { check, formText } from "@/lib/validation/core";
import {
  passwordResetRequestSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/actions";

function toSigninWithError(message: string): never {
  redirect(`/signin?error=${encodeURIComponent(message)}`);
}

function toSignupWithError(message: string): never {
  redirect(`/signup?error=${encodeURIComponent(message)}`);
}

function toForgotWithError(message: string): never {
  redirect(`/forgot-password?error=${encodeURIComponent(message)}`);
}

// The user-facing origin. Behind Traefik the request origin is the internal
// container address, so it has to come from the forwarded header — the same
// reason /auth/callback does it. Any URL built from this and handed to GoTrue
// must also be in ADDITIONAL_REDIRECT_URLS or the mail is silently not sent.
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function signUp(formData: FormData) {
  // Validated BEFORE the rate limiter, same order as before: a malformed
  // request was never worth a token out of someone's hourly budget.
  const parsed = check(signUpSchema, {
    email: formText(formData, "email") ?? "",
    password: formText(formData, "password") ?? "",
  });
  if (!parsed.ok) toSignupWithError(parsed.error);
  const { email, password } = parsed.data;

  // Brute-force / spam-signup speed bump (per IP). Fail-open — inert until
  // Upstash is configured (Phase 1). Limit is generous: a human never hits it,
  // a script gets stopped cold.
  const ip = await clientIp();
  const signupLimit = await rateLimit("signup", ip, {
    limit: 6,
    windowSec: 3600,
  });
  if (!signupLimit.ok) {
    toSignupWithError(
      "Too many sign-up attempts from your network. Please try again later.",
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Where the confirmation link lands. /auth/callback already exchanges the
    // code and seeds the starter op codes — the same landing Google sign-in
    // uses — so a confirmed account arrives complete instead of empty.
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("fetch") || msg.includes("network") || (error.status ?? 0) === 0) {
      toSignupWithError("Unable to connect to the server. Please try again.");
    } else {
      toSignupWithError(error.message);
    }
  }

  // With email confirmation ON, signUp returns NO session: the account exists
  // but cannot be used until the link is clicked. Falling through to /dashboard
  // here would bounce off the proxy to /signin with no explanation — the user
  // would think signing up had failed. Seeding is skipped too, because there is
  // no session for RLS to hang the rows on; /auth/callback does it after they
  // confirm.
  //
  // Branching on the session rather than on a config flag keeps this correct
  // whichever way ENABLE_EMAIL_AUTOCONFIRM is set.
  if (!data.session) {
    redirect("/signup?check=1");
  }

  // Confirmation off: the user is signed in already. Seed and go.
  // Non-fatal — if this fails the user can add codes manually.
  try {
    await seedStarterOpCodesIfEmpty(supabase);
  } catch (err) {
    // Non-fatal for the user, but no longer silent — report it so a broken seed
    // (e.g. RLS/schema drift) is visible instead of leaving accounts empty.
    await reportServerError(err, { url: "action:signUp/seedStarterOpCodes" });
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signIn(formData: FormData) {
  const parsed = check(signInSchema, {
    email: formText(formData, "email") ?? "",
    password: formText(formData, "password") ?? "",
  });
  if (!parsed.ok) toSigninWithError(parsed.error);
  const { email, password } = parsed.data;

  // Two-key brute-force protection: per-IP (broad, stops a host hammering many
  // accounts) and per-email (protects one account from a distributed guess).
  // Fail-open — inert until Upstash is configured (Phase 1).
  const ip = await clientIp();
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit("signin-ip", ip, { limit: 20, windowSec: 600 }),
    rateLimit("signin-email", email.toLowerCase(), { limit: 8, windowSec: 900 }),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    toSigninWithError(
      "Too many sign-in attempts. Please wait a few minutes and try again.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("fetch") || msg.includes("network") || (error.status ?? 0) === 0) {
      toSigninWithError("Unable to connect to the server. Please try again.");
    } else if (msg.includes("invalid login") || msg.includes("invalid credentials") || error.status === 400) {
      toSigninWithError("Incorrect email or password.");
    } else {
      toSigninWithError(error.message);
    }
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Send a password-recovery email.
//
// ALWAYS REPORTS SUCCESS, even for an address with no account. This form is
// reachable without a session by definition, so a response that distinguished
// "sent" from "no such user" would turn it into an account-enumeration oracle
// for anyone with a word list. The only signal a caller gets back is "if that
// address has an account, mail is on its way".
//
// A send FAILURE is swallowed for the same reason and reported instead, so a
// broken mailer shows up in client_errors rather than in the response. That
// matters right now: SMTP is still the stock placeholder, so this currently
// errors on every call and the report is the only place it will be visible.
export async function requestPasswordReset(formData: FormData) {
  const parsed = check(passwordResetRequestSchema, {
    email: formText(formData, "email") ?? "",
  });
  if (!parsed.ok) toForgotWithError(parsed.error);
  const { email } = parsed.data;

  // Two keys, same reasoning as signIn: per-IP stops one host spraying many
  // addresses, per-email stops a single account being mail-bombed through the
  // form. Tighter than sign-in because a legitimate user needs one email, not
  // eight. Fail-open — inert until Upstash is configured.
  const ip = await clientIp();
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit("reset-ip", ip, { limit: 10, windowSec: 3600 }),
    rateLimit("reset-email", email.toLowerCase(), { limit: 4, windowSec: 3600 }),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    toForgotWithError("Too many reset requests. Please wait a while and try again.");
  }

  const origin = await siteOrigin();

  // IMPLICIT FLOW ON PURPOSE — do not "fix" this back to the SSR client.
  //
  // The app's normal client is PKCE, which binds the emailed link to a
  // code-verifier COOKIE in the browser that asked for it. That makes a reset
  // link unusable anywhere else: request it on your phone, open the mail on
  // your laptop, and you get a perfectly valid code the laptop can never
  // exchange. For a link whose entire job is to rescue someone who is locked
  // out, "only works in the browser you started from" is a trap — and the
  // failure is invisible, because the link looks fine right up until it isn't.
  //
  // An isolated implicit client sends no challenge, so GoTrue returns the
  // tokens in the URL fragment and the link stands alone on any device.
  // /reset-password reads both shapes; this is now the one it will usually see.
  //
  // The trade: the token rides in the fragment instead of being cookie-bound.
  // It is single-use, short-lived, never sent to the server by the browser, and
  // /reset-password strips it from the address bar as soon as it is consumed.
  const mailer = createIsolatedClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await mailer.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error) {
    await reportServerError(error, { url: "action:requestPasswordReset" });
  }

  redirect("/forgot-password?sent=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/signin");
}
