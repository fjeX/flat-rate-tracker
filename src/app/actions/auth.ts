"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { seedStarterOpCodesIfEmpty } from "@/lib/seed-opcodes";
import { reportServerError } from "@/lib/report-error-server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

function toSigninWithError(message: string): never {
  redirect(`/signin?error=${encodeURIComponent(message)}`);
}

function toSignupWithError(message: string): never {
  redirect(`/signup?error=${encodeURIComponent(message)}`);
}

function toForgotWithError(message: string): never {
  redirect(`/forgot-password?error=${encodeURIComponent(message)}`);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    toSignupWithError("Email and password are required.");
  }
  if (password.length < 8) {
    toSignupWithError("Password must be at least 8 characters.");
  }

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
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("fetch") || msg.includes("network") || (error.status ?? 0) === 0) {
      toSignupWithError("Unable to connect to the server. Please try again.");
    } else {
      toSignupWithError(error.message);
    }
  }

  // Seed default op code library for the new account.
  // Non-fatal — if this fails the user can add codes manually.
  try {
    await seedStarterOpCodesIfEmpty(supabase);
  } catch (err) {
    // Non-fatal for the user, but no longer silent — report it so a broken seed
    // (e.g. RLS/schema drift) is visible instead of leaving accounts empty.
    await reportServerError(err, { url: "action:signUp/seedStarterOpCodes" });
  }

  // Local dev has email confirmation disabled, so the user is signed in
  // immediately. On phase-2+ with confirmation on, the user would land here
  // but have no session until they click the confirm link — adjust then.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    toSigninWithError("Email and password are required.");
  }

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
  const email = String(formData.get("email") ?? "").trim();
  if (!email) toForgotWithError("Enter the email address on your account.");

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

  // Behind Traefik the request origin is the internal container address, so the
  // user-facing host has to come from the forwarded header — same reason
  // /auth/callback does it. This URL must also be listed in the GoTrue
  // ADDITIONAL_REDIRECT_URLS allow-list or the mail is never sent.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
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
