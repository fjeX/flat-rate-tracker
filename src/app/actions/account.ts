"use server";

import { createClient as createIsolatedClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { serverSupabaseUrl } from "@/lib/supabase/config";
import { revalidatePath } from "next/cache";
import { check, formText } from "@/lib/validation/core";
import {
  profileFormSchema,
  updateEmailSchema,
  updatePasswordSchema,
} from "@/lib/validation/actions";

export async function updateProfile(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = check(profileFormSchema, {
    firstName: formText(formData, "first_name") ?? "",
    lastName: formText(formData, "last_name") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };
  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { first_name: firstName, last_name: lastName },
  });

  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/account");
  return { message: "Profile updated." };
}

export async function updateEmail(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = check(updateEmailSchema, {
    email: formText(formData, "email") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };
  const { email } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) return { error: error.message };
  return { message: "Check your inbox to confirm your new email address." };
}

// Verify a password WITHOUT disturbing the caller's session.
//
// signInWithPassword on the request-scoped client would write a fresh session
// into the cookie jar as a side effect — a rotated session as the by-product of
// a check that might fail. This client is built per call with persistSession
// off, so it authenticates, answers the question, and is thrown away.
//
// GoTrue has no "just check this password" endpoint, so a successful check does
// mint a real session server-side that nobody then uses. It is deliberately NOT
// signed out afterwards: signOut() defaults to global scope and would revoke
// every session the user has, logging them out of every device to confirm a
// password. The orphan expires on its own, and password changes are rare.
async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const verifier = createIsolatedClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await verifier.auth.signInWithPassword({ email, password });
  return !error;
}

// Changing a password must prove you know the CURRENT one.
//
// WHY: every other check in this app answers "which rows may this session
// touch". None of them asks "is this session still the person who owns the
// account". Without that question a live session is enough to set a new
// password and lock the real owner out permanently — the difference between
// finding a door unlocked and having the key recut.
//
// Deliberately NOT GoTrue's SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION.
// That mails a six-digit nonce, and this deployment has no working mailer
// (SMTP is still the stock placeholder), so switching it on would make password
// changes impossible rather than safer. This check needs no email at all.
export async function updatePassword(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = check(updatePasswordSchema, {
    currentPassword: formText(formData, "current_password") ?? "",
    newPassword: formText(formData, "new_password") ?? "",
    confirmPassword: formText(formData, "confirm_password") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };
  const { currentPassword, newPassword } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // A Google-only account has no password yet, so there is nothing to prove —
  // this is them setting their first one. Anyone carrying an `email` identity
  // has a password and must confirm it. Derived from the identity list rather
  // than a flag on the form, so the client cannot opt itself out of the check.
  const hasPassword = user.identities?.some((i) => i.provider === "email") ?? true;

  if (hasPassword) {
    if (!currentPassword) return { error: "Enter your current password." };
    if (!user.email) return { error: "This account has no email address to verify against." };
    if (!(await passwordIsCorrect(user.email, currentPassword))) {
      return { error: "Current password is incorrect." };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) return { error: error.message };
  return { message: "Password changed successfully." };
}
