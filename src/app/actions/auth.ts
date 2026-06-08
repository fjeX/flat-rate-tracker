"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { STARTER_OP_CODES } from "@/lib/starter-opcodes";

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
    for (const starter of STARTER_OP_CODES) {
      await db.createOpCode(supabase, {
        code: starter.code,
        description: starter.description,
        flagHours: starter.flagHours,
        notes: "",
      });
    }
  } catch { /* ignore seeding errors */ }

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
