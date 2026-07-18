"use server";

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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/signin");
}
